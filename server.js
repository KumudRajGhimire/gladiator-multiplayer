const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

// --- CONSTANTS ---
const TICK_RATE = 60;
const MAP_RADIUS = 470; 
const PLAYER_RADIUS = 25;

// Physics Config
const WALK_SPEED = 7;
const RUN_SPEED = 21;
const DASH_FORCE = 70;
const ACCELERATION = 2;    
const FRICTION = 0.85;

// Cooldowns
const ATTACK_COOLDOWN = 400; 
const DASH_COOLDOWN = 800;  
const WIN_SCORE = 5; 

// --- SECURITY SETTINGS ---
const MAX_PACKETS_PER_SEC = 500; // If they send more than 50 commands/sec, kick them
const ALLOW_ONE_PER_IP = true;  // Set to false if testing locally

// --- STATE ---
let players = {};
let rooms = {}; 
let connectedIPs = {}; // Track IPs to prevent multi-tabbing

io.on('connection', (socket) => {
    // 1. GET REAL IP ADDRESS (Works on Render/Heroku proxies)
    const rawIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
    // If multiple IPs are listed (proxy chain), take the first one
    const userIp = rawIp.split(',')[0].trim();

    console.log(`Connection attempt: ${socket.id} from ${userIp}`);

    // 2. IP LIMITING CHECK
    if (ALLOW_ONE_PER_IP && connectedIPs[userIp]) {
        console.log(`Blocked duplicate IP: ${userIp}`);
        socket.emit('error', 'Only one active game per IP address allowed.');
        socket.disconnect(true);
        return;
    }
    
    // Mark IP as active
    connectedIPs[userIp] = true;

    // 3. PACKET RATE LIMITER (Anti-Spam)
    let packetCount = 0;
    const rateLimitInterval = setInterval(() => {
        if (packetCount > MAX_PACKETS_PER_SEC) {
            console.log(`Kicking spammer: ${socket.id}`);
            socket.disconnect(true);
        }
        packetCount = 0;
    }, 1000);

    // Middleware to count every packet they send
    socket.use((packet, next) => {
        packetCount++;
        next();
    });

    socket.on('joinGame', (data) => {
        // Sanitize Input Name (Prevent HTML injection or huge names)
        let safeName = (data.name || "Gladiator").replace(/[^a-zA-Z0-9 ]/g, "");
        const roomId = data.room || "global";
        
        socket.join(roomId);

        if (!rooms[roomId]) rooms[roomId] = { isResetting: false };

        players[socket.id] = {
            id: socket.id,
            room: roomId,
            name: safeName.substring(0, 10),
            x: 0, y: 0,
            vx: 0, vy: 0,
            angle: 0,
            hp: 100,
            score: 0,
            inputs: { w: false, a: false, s: false, d: false, shift: false },
            lastAttack: 0,
            lastDash: 0
        };
        socket.emit('gameJoined');
    });

    socket.on('input', (keys) => {
        if (players[socket.id]) {
            // 4. INPUT SANITIZATION
            // Force values to be booleans. If hacker sends {w: 1000}, it becomes true/false.
            players[socket.id].inputs = {
                w: !!keys.w,
                a: !!keys.a,
                s: !!keys.s,
                d: !!keys.d,
                shift: !!keys.shift
            };
        }
    });

    socket.on('aim', (angle) => {
        // Ensure angle is a Number
        if (players[socket.id] && typeof angle === 'number') {
            players[socket.id].angle = angle;
        }
    });

    socket.on('attack', () => {
        const p = players[socket.id];
        if (!p || rooms[p.room].isResetting) return;
        
        const now = Date.now();
        if (now - p.lastAttack < ATTACK_COOLDOWN) return;
        p.lastAttack = now;
        checkCombat(p);
    });

    socket.on('dash', () => {
        const p = players[socket.id];
        if (!p || rooms[p.room].isResetting) return;

        const now = Date.now();
        if (now - p.lastDash < DASH_COOLDOWN) return;
        p.lastDash = now;

        p.vx = Math.cos(p.angle) * DASH_FORCE;
        p.vy = Math.sin(p.angle) * DASH_FORCE;
    });

    socket.on('disconnect', () => {
        console.log(`Disconnected: ${socket.id}`);
        // Clear IP lock so they can join again
        delete connectedIPs[userIp];
        clearInterval(rateLimitInterval);
        
        if (players[socket.id]) delete players[socket.id];
    });
});

// --- PHYSICS LOOP ---
setInterval(() => {
    let roomPackets = {};

    for (let id in players) {
        let p = players[id];
        if (!roomPackets[p.room]) roomPackets[p.room] = {};
        if (rooms[p.room].isResetting) {
            roomPackets[p.room][id] = p; 
            continue;
        }

        let currentMaxSpeed = p.inputs.shift ? RUN_SPEED : WALK_SPEED;

        if (p.inputs.w) p.vy -= ACCELERATION;
        if (p.inputs.s) p.vy += ACCELERATION;
        if (p.inputs.a) p.vx -= ACCELERATION;
        if (p.inputs.d) p.vx += ACCELERATION;

        p.vx *= FRICTION; 
        p.vy *= FRICTION;

        const currentSpeed = Math.sqrt(p.vx*p.vx + p.vy*p.vy);
        if (currentSpeed > currentMaxSpeed) {
            if (currentSpeed < DASH_FORCE - 5) {
                const scale = currentMaxSpeed / currentSpeed;
                p.vx *= scale;
                p.vy *= scale;
            }
        }

        p.x += p.vx;
        p.y += p.vy;

        const dist = Math.sqrt(p.x * p.x + p.y * p.y);
        if (dist + PLAYER_RADIUS > MAP_RADIUS) {
            const angle = Math.atan2(p.y, p.x);
            p.x = Math.cos(angle) * (MAP_RADIUS - PLAYER_RADIUS);
            p.y = Math.sin(angle) * (MAP_RADIUS - PLAYER_RADIUS);
            p.vx *= -0.5; p.vy *= -0.5;
        }

        roomPackets[p.room][id] = p;
    }

    for (let roomId in roomPackets) {
        io.to(roomId).emit('update', roomPackets[roomId]);
    }
}, 1000 / TICK_RATE);

function checkCombat(attacker) {
    const roomId = attacker.room;
    io.to(roomId).emit('playerAttacked', { id: attacker.id });

    for (let id in players) {
        const target = players[id];
        if (target.room !== roomId || target.id === attacker.id) continue;

        const dx = target.x - attacker.x;
        const dy = target.y - attacker.y;
        const dist = Math.sqrt(dx*dx + dy*dy);

        if (dist < 60) {
            target.hp -= 10;
            const hitAngle = Math.atan2(dy, dx);
            target.vx += Math.cos(hitAngle) * 30; 
            target.vy += Math.sin(hitAngle) * 30;

            io.to(roomId).emit('hit', { id: target.id });

            if (target.hp <= 0) {
                attacker.score++;
                target.hp = 100;
                target.x = 0; target.y = 0; target.vx = 0; target.vy = 0;

                if (attacker.score >= WIN_SCORE) {
                    io.to(roomId).emit('gameOver', attacker.name);
                    resetGame(roomId);
                }
            }
        }
    }
}

function resetGame(roomId) {
    if (!rooms[roomId]) return;
    rooms[roomId].isResetting = true;
    setTimeout(() => {
        for (let id in players) {
            if (players[id].room === roomId) {
                players[id].score = 0; players[id].hp = 100;
                players[id].x = 0; players[id].y = 0;
                players[id].vx = 0; players[id].vy = 0;
            }
        }
        if (rooms[roomId]) rooms[roomId].isResetting = false;
    }, 5000);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));