const express = require('express');
const app = express();
const http = require('http').createServer(app);
// Enable CORS for connection stability
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 1e3, 
    pingTimeout: 10000,
    pingInterval: 5000
});

app.use(express.static('public'));

// --- CONSTANTS ---
const TICK_RATE = 60;
const MAP_RADIUS = 470; 
const PLAYER_RADIUS = 25;

// Physics Config
const WALK_SPEED = 7;
const RUN_SPEED = 21;
const ACCELERATION = 2;    
const FRICTION = 0.85;

// Game Rules
const ATTACK_COOLDOWN = 400; 
const RESPAWN_TIME = 3000; 
const WIN_SCORE = 5; 

// --- SECURITY ---
const MAX_PACKETS_PER_SEC = 500; 
const MAX_CONNECTIONS_PER_IP = 10; // Allow 10 friends on one Wi-Fi

// --- STATE ---
let players = {};
let rooms = {}; 
let ipCounts = {}; // CHANGED: Track count instead of boolean
let healthDrops = {}; 
let dropIdCounter = 0;

// Global Crash Handler
process.on('uncaughtException', (err) => { console.log('Caught:', err); });

io.on('connection', (socket) => {
    // 1. IP CHECK
    let userIp = "unknown";
    try {
        const rawIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
        userIp = rawIp.split(',')[0].trim();
    } catch (e) {}

    console.log(`Connection: ${socket.id} from ${userIp}`);

    // Initialize count if new
    if (!ipCounts[userIp]) ipCounts[userIp] = 0;

    // CHECK LIMIT
    if (ipCounts[userIp] >= MAX_CONNECTIONS_PER_IP) {
        console.log(`Blocked IP ${userIp} (Too many connections)`);
        socket.emit('error', 'Too many connections from this IP.');
        socket.disconnect(true);
        return;
    }

    // Increment Count
    ipCounts[userIp]++;

    // 2. RATE LIMITER
    let packetCount = 0;
    const rateLimitInterval = setInterval(() => {
        if (packetCount > MAX_PACKETS_PER_SEC) {
            socket.disconnect(true);
        }
        packetCount = 0;
    }, 1000);
    socket.use((p, n) => { packetCount++; n(); });

    // --- HANDLERS ---

    socket.on('joinGame', (data) => {
        try {
            if (!data || typeof data !== 'object') return;
            
            let rawName = data.name || "Gladiator";
            let safeName = String(rawName).replace(/[^a-zA-Z0-9 ]/g, "").substring(0, 12);
            let rawRoom = data.room || "global";
            let safeRoom = String(rawRoom).replace(/[^a-zA-Z0-9]/g, "").substring(0, 6);

            socket.join(safeRoom);
            if (!rooms[safeRoom]) rooms[safeRoom] = { isResetting: false };

            // Random Armor/Leather Colors
            const isArmor = Math.random() > 0.5;
            let randomColor = isArmor 
                ? `hsl(210, ${Math.random() * 15}%, ${40 + Math.random() * 30}%)`
                : `hsl(${25 + Math.random() * 15}, ${50 + Math.random() * 30}%, ${30 + Math.random() * 20}%)`;

            players[socket.id] = {
                id: socket.id,
                room: safeRoom,
                name: safeName,
                x: 0, y: 0,
                vx: 0, vy: 0,
                angle: 0,
                color: randomColor,
                hp: 100,
                score: 0,
                inputs: { w: false, a: false, s: false, d: false, shift: false },
                lastAttack: 0,
                isDead: false,
                respawnTime: 0
            };
            socket.emit('gameJoined');
            socket.emit('healthDropsUpdate', filterDropsByRoom(safeRoom));
        } catch (e) {}
    });

    socket.on('input', (keys) => {
        try {
            if (players[socket.id] && keys) {
                players[socket.id].inputs = {
                    w: !!keys.w, a: !!keys.a, s: !!keys.s, d: !!keys.d, shift: !!keys.shift
                };
            }
        } catch (e) {}
    });

    socket.on('aim', (a) => { 
        try { if (players[socket.id] && typeof a === 'number' && !isNaN(a)) players[socket.id].angle = a; } catch(e) {}
    });

    socket.on('attack', () => {
        try {
            const p = players[socket.id];
            if (!p || p.isDead || rooms[p.room].isResetting) return;
            
            const now = Date.now();
            if (now - p.lastAttack < ATTACK_COOLDOWN) return;
            p.lastAttack = now;
            checkCombat(p);
        } catch(e) {}
    });

    socket.on('disconnect', () => {
        // Decrement IP Count
        if (ipCounts[userIp]) {
            ipCounts[userIp]--;
            if (ipCounts[userIp] <= 0) delete ipCounts[userIp];
        }

        clearInterval(rateLimitInterval);
        if (players[socket.id]) delete players[socket.id];
    });
});

setInterval(() => {
    let roomPackets = {};

    for (let id in players) {
        let p = players[id];
        if (!p.room) continue; 
        
        if (!roomPackets[p.room]) roomPackets[p.room] = {};
        if (rooms[p.room] && rooms[p.room].isResetting) { roomPackets[p.room][id] = p; continue; }
        
        if (p.isDead) {
            if (Date.now() > p.respawnTime) {
                p.isDead = false;
                p.hp = 100;
                const spawnAngle = Math.random() * Math.PI * 2;
                const spawnDist = Math.random() * (MAP_RADIUS - 50);
                p.x = Math.cos(spawnAngle) * spawnDist;
                p.y = Math.sin(spawnAngle) * spawnDist;
                io.to(p.room).emit('playerRespawned', { id: p.id });
            }
            roomPackets[p.room][id] = p;
            continue;
        }

        let currentMaxSpeed = p.inputs.shift ? RUN_SPEED : WALK_SPEED;

        if (p.inputs.w) p.vy -= ACCELERATION;
        if (p.inputs.s) p.vy += ACCELERATION;
        if (p.inputs.a) p.vx -= ACCELERATION;
        if (p.inputs.d) p.vx += ACCELERATION;

        p.vx *= FRICTION; p.vy *= FRICTION;

        const currentSpeed = Math.sqrt(p.vx*p.vx + p.vy*p.vy);
        if (currentSpeed > currentMaxSpeed) {
             const scale = currentMaxSpeed / currentSpeed;
             p.vx *= scale; p.vy *= scale;
        }

        p.x += p.vx; p.y += p.vy;

        const dist = Math.sqrt(p.x * p.x + p.y * p.y);
        if (dist + PLAYER_RADIUS > MAP_RADIUS) {
            const angle = Math.atan2(p.y, p.x);
            p.x = Math.cos(angle) * (MAP_RADIUS - PLAYER_RADIUS);
            p.y = Math.sin(angle) * (MAP_RADIUS - PLAYER_RADIUS);
            p.vx *= -0.5; p.vy *= -0.5;
        }
        
        if (p.hp < 100) checkItemPickup(p);

        roomPackets[p.room][id] = p;
    }

    for (let r in roomPackets) io.to(r).emit('update', roomPackets[r]);
}, 1000 / TICK_RATE);

function checkCombat(attacker) {
    const roomId = attacker.room;
    io.to(roomId).emit('playerAttacked', { id: attacker.id });

    const speed = Math.sqrt(attacker.vx * attacker.vx + attacker.vy * attacker.vy);
    let damage = 10 + (speed / RUN_SPEED) * 20;
    if (damage < 10) damage = 10;
    if (damage > 30) damage = 30;
    
    const knockbackForce = 20 + (speed * 1.5); 

    for (let id in players) {
        const target = players[id];
        if (target.room !== roomId || target.id === attacker.id || target.isDead) continue;

        const dx = target.x - attacker.x;
        const dy = target.y - attacker.y;
        const dist = Math.sqrt(dx*dx + dy*dy);

        if (dist < 60) {
            target.hp -= Math.floor(damage);
            const hitAngle = Math.atan2(dy, dx);
            target.vx += Math.cos(hitAngle) * knockbackForce;
            target.vy += Math.sin(hitAngle) * knockbackForce;

            io.to(roomId).emit('hit', { id: target.id, dmg: Math.floor(damage) });
            io.to(roomId).emit('bloodEffect', { x: target.x, y: target.y });

            if (target.hp <= 0) {
                attacker.score++;
                spawnHealthDrop(target.x, target.y, roomId);

                target.isDead = true;
                target.hp = 0;
                target.vx = 0; target.vy = 0;
                target.respawnTime = Date.now() + RESPAWN_TIME;

                io.to(roomId).emit('playerDied', { 
                    id: target.id, x: target.x, y: target.y, respawnIn: RESPAWN_TIME
                });
                io.to(target.id).emit('respawnTimer', RESPAWN_TIME);

                if (attacker.score >= WIN_SCORE) {
                    io.to(roomId).emit('gameOver', attacker.name);
                    resetGame(roomId);
                }
            }
        }
    }
}

function spawnHealthDrop(x, y, room) {
    const id = `drop_${dropIdCounter++}`;
    healthDrops[id] = { x, y, room };
    io.to(room).emit('healthDropsUpdate', filterDropsByRoom(room));
}

function checkItemPickup(p) {
    for (let id in healthDrops) {
        let drop = healthDrops[id];
        if (drop.room !== p.room) continue;

        const dx = p.x - drop.x;
        const dy = p.y - drop.y;
        if (Math.sqrt(dx*dx + dy*dy) < 30) {
            p.hp = Math.min(p.hp + 50, 100); 
            delete healthDrops[id];
            io.to(p.room).emit('healthDropsUpdate', filterDropsByRoom(p.room));
            return; 
        }
    }
}

function filterDropsByRoom(roomId) {
    let roomDrops = {};
    for (let id in healthDrops) {
        if (healthDrops[id].room === roomId) roomDrops[id] = healthDrops[id];
    }
    return roomDrops;
}

function resetGame(roomId) {
    if (!rooms[roomId]) return;
    rooms[roomId].isResetting = true;
    for(let id in healthDrops) {
        if(healthDrops[id].room === roomId) delete healthDrops[id];
    }
    io.to(roomId).emit('healthDropsUpdate', {});

    setTimeout(() => {
        for (let id in players) {
            if (players[id].room === roomId) {
                players[id].score = 0; players[id].hp = 100;
                players[id].isDead = false;
                players[id].x = 0; players[id].y = 0; players[id].vx = 0; players[id].vy = 0;
            }
        }
        if (rooms[roomId]) rooms[roomId].isResetting = false;
    }, 5000);
}

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => console.log(`Server running on port ${PORT}`));