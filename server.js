const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

// --- GAME CONSTANTS ---
const TICK_RATE = 60;

// CIRCLE SETTINGS
const MAP_RADIUS = 500; // The size of the circular pit
const PLAYER_RADIUS = 25;

const MOVEMENT_SPEED = 1.5;
const FRICTION = 0.88; 
const KNOCKBACK = 30;

let players = {};

io.on('connection', (socket) => {
    console.log('Gladiator connected:', socket.id);

    players[socket.id] = {
        id: socket.id,
        x: 0, y: 0,
        vx: 0, vy: 0,
        angle: 0,
        color: `hsl(${Math.random() * 360}, 80%, 50%)`,
        hp: 100,
        score: 0,
        inputs: { w: false, a: false, s: false, d: false }
    };

    io.emit('update', players);

    socket.on('input', (keys) => {
        if (players[socket.id]) players[socket.id].inputs = keys;
    });

    socket.on('aim', (angle) => {
        if (players[socket.id]) players[socket.id].angle = angle;
    });

    socket.on('attack', () => {
        const attacker = players[socket.id];
        if (!attacker) return;
        
        // Dash Attack
        attacker.vx += Math.cos(attacker.angle) * 20;
        attacker.vy += Math.sin(attacker.angle) * 20;

        checkCombat(socket.id);
    });

    socket.on('disconnect', () => {
        delete players[socket.id];
    });
});

// --- PHYSICS LOOP ---
setInterval(() => {
    for (let id in players) {
        let p = players[id];

        // 1. Move
        if (p.inputs.w) p.vy -= MOVEMENT_SPEED;
        if (p.inputs.s) p.vy += MOVEMENT_SPEED;
        if (p.inputs.a) p.vx -= MOVEMENT_SPEED;
        if (p.inputs.d) p.vx += MOVEMENT_SPEED;

        p.vx *= FRICTION;
        p.vy *= FRICTION;
        p.x += p.vx;
        p.y += p.vy;

        // --- NEW: CIRCULAR COLLISION LOGIC ---
        // Simple distance check from center (0,0)
        const dist = Math.sqrt(p.x * p.x + p.y * p.y);

        // If distance + player radius > map radius, we hit the wall
        if (dist + PLAYER_RADIUS > MAP_RADIUS) {
            // Calculate angle from center
            const angle = Math.atan2(p.y, p.x);
            
            // Push player back to the edge
            p.x = Math.cos(angle) * (MAP_RADIUS - PLAYER_RADIUS);
            p.y = Math.sin(angle) * (MAP_RADIUS - PLAYER_RADIUS);

            // Bounce (Reverse velocity)
            p.vx *= -0.5;
            p.vy *= -0.5;
        }
        // -------------------------------------
    }

    io.emit('update', players);

}, 1000 / TICK_RATE);

function checkCombat(attackerId) {
    const p1 = players[attackerId];
    
    for (let id in players) {
        if (id === attackerId) continue;
        const p2 = players[id];

        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const dist = Math.sqrt(dx*dx + dy*dy);

        if (dist < 60) {
            p2.hp -= 10;
            const hitAngle = Math.atan2(dy, dx);
            p2.vx += Math.cos(hitAngle) * KNOCKBACK;
            p2.vy += Math.sin(hitAngle) * KNOCKBACK;

            io.emit('hit', { id: id });

            if (p2.hp <= 0) {
                p1.score++;
                p2.hp = 100;
                p2.x = 0; p2.y = 0;
                p2.vx = 0; p2.vy = 0;
            }
        }
    }
}

http.listen(3000, () => {
    console.log('Gladiator Server (Circular Mode) running on *:3000');
});