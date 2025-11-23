const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- SETUP ---
const MAP_RADIUS = 470; // <--- REDUCED SIZE
ctx.imageSmoothingEnabled = false; 
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

// Prevent Right Click Menu
window.oncontextmenu = (e) => { e.preventDefault(); }

// --- ASSETS ---
const spriteSheet = new Image(); spriteSheet.src = '/sprites.png';
const runSfx = new Audio('/run.wav'); runSfx.loop = true; runSfx.volume = 0.5; 
const attackSfx = new Audio('/attack.wav'); attackSfx.volume = 0.6;
const hitSfx = new Audio('/hit.wav'); hitSfx.volume = 0.8;
const pickupSfx = new Audio('/pickup.wav'); pickupSfx.volume = 0.6; // optional
const healthImg = new Image(); healthImg.src = '/health.png'; // 32x32 heart or potion

// --- STATE ---
let players = {};
let myId = null;
let gameActive = false;
let playerAnimState = {}; 
let winnerText = "";

// Blood particles and health drops
let bloodParticles = [];
let healthDrops = {};

// respawn timers per-player (ms timestamp)
let respawnTimers = {};
let myRespawnEnd = null;

// --- LOGIN ---
function joinGame() {
    const name = document.getElementById('usernameInput').value || "Gladiator";
    const room = document.getElementById('roomInput').value || "global";
    socket.emit('joinGame', { name: name, room: room });
    document.getElementById('start-screen').style.display = 'none';
    document.getElementById('ui-layer').style.display = 'block';
    document.getElementById('displayRoom').innerText = room;
    runSfx.play().then(() => runSfx.pause());
}

// --- NETWORK HANDLERS ---
socket.on('connect', () => { myId = socket.id; });
socket.on('gameJoined', () => { gameActive = true; });

socket.on('update', (serverPlayers) => {
    players = serverPlayers;
    updateScoreboard();
    // cleanup anim states for players that left
    for (let id in playerAnimState) {
        if (!players[id]) delete playerAnimState[id];
    }
});

socket.on('playerAttacked', (data) => {
    if (playerAnimState[data.id]) {
        playerAnimState[data.id].action = 'ATTACK';
        playerAnimState[data.id].frame = 0;
        playSound(attackSfx);
    }
});

socket.on('hit', (data) => {
    if(playerAnimState[data.id]) {
        playerAnimState[data.id].action = 'HIT';
        playerAnimState[data.id].frame = 0;
        playSound(hitSfx);
    }
    // Note: server also sends 'bloodEffect' with coordinates; prefer that for accurate blood
});

socket.on('bloodEffect', (data) => {
    // data: { x, y }
    spawnBlood(data.x, data.y);
});

socket.on('healthDropsUpdate', (drops) => {
    healthDrops = drops || {};
});

socket.on('respawnTimer', (msLeft) => {
    // Only sent to the dead player
    myRespawnEnd = Date.now() + msLeft;
});

socket.on('playerDied', (data) => {
    // data: { id, x, y, respawnIn }
    spawnBlood(data.x, data.y);
    respawnTimers[data.id] = Date.now() + data.respawnIn;
});

socket.on('playerRespawned', (data) => {
    // remove respawn timer for that player
    delete respawnTimers[data.id];
    if (data.id === myId) myRespawnEnd = null;
});

socket.on('gameOver', (winnerName) => {
    winnerText = `${winnerName} WINS!`;
    playSound(hitSfx);
    setTimeout(() => { winnerText = ""; }, 5000);
});

socket.on('roomResetting', (ms) => {
    // optional: show UI if you want when server resets room
});

// --- CONTROLS ---
let keys = { w: false, a: false, s: false, d: false, shift: false };

window.addEventListener('keydown', (e) => {
    if (!gameActive) return;
    
    // Explicitly check Shift
    if (e.key === "Shift") keys.shift = true;
    
    const key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = true;
    
    socket.emit('input', keys); 
});

window.addEventListener('keyup', (e) => {
    if (!gameActive) return;

    if (e.key === "Shift") keys.shift = false;

    const key = e.key.toLowerCase();
    if (keys.hasOwnProperty(key)) keys[key] = false;

    socket.emit('input', keys); 
});

// FIX STICKY KEYS: Reset keys if user clicks away or alt-tabs
window.addEventListener('blur', () => {
    keys = { w: false, a: false, s: false, d: false, shift: false };
    socket.emit('input', keys);
});

window.addEventListener('mousemove', (e) => {
    if (!gameActive || !players[myId]) return;
    const p = players[myId];
    const screenX = (canvas.width/2) + p.x;
    const screenY = (canvas.height/2) + p.y;
    const angle = Math.atan2(e.clientY - screenY, e.clientX - screenX);
    socket.emit('aim', angle);
});

window.addEventListener('mousedown', (e) => {
    if (!gameActive) return;
    if (e.button === 0) {
        socket.emit('attack');
        if (playerAnimState[myId]) {
            playerAnimState[myId].action = 'ATTACK'; playerAnimState[myId].frame = 0;
        }
    }
    if (e.button === 2) {
        socket.emit('dash');
    }
});

function playSound(audio) {
    const clone = audio.cloneNode(); 
    clone.volume = audio.volume;
    clone.play().catch(e => {});
}

function updateScoreboard() {
    if (!myId || !players[myId]) return;
    const p = players[myId];
    document.getElementById('scoreboard').innerText = `${p.name} | HP: ${Math.floor(p.hp)} | Kills: ${p.score}`;
}

// --- BLOOD PARTICLE EFFECTS ---
function spawnBlood(x, y) {
    for (let i = 0; i < 18; i++) {
        bloodParticles.push({
            x: x + (Math.random()-0.5)*8,
            y: y + (Math.random()-0.5)*8,
            vx: (Math.random() - 0.5) * 6,
            vy: (Math.random() - 0.5) * 6,
            life: 18 + Math.random() * 12,
            size: 2 + Math.random() * 3
        });
    }
}

// --- RENDER ---
const SPRITE_SIZE = 32; const DRAW_SIZE = 64;   
const ANIMATIONS = {
    IDLE: { row: 0, maxFrames: 5, speed: 10 },
    RUN: { row: 1, maxFrames: 8, speed: 4 }, 
    ATTACK: { row: 2, maxFrames: 7, speed: 3 },
    HIT: { row: 3, maxFrames: 3, speed: 5 },
    DEATH: { row: 4, maxFrames: 7, speed: 8 }
};

function getPlayerAction(p, currentState) {
    if (p.hp <= 0) return 'DEATH';
    if (currentState) {
        const anim = ANIMATIONS[currentState.action];
        if ((currentState.action === 'ATTACK' || currentState.action === 'HIT') && currentState.frame < anim.maxFrames - 1) return currentState.action;
    }
    // Only run if actually moving fast (avoids skating)
    if (Math.abs(p.vx) > 1 || Math.abs(p.vy) > 1) return 'RUN'; 
    return 'IDLE';
}

function draw() {
    requestAnimationFrame(draw);
    if (!gameActive) return;

    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save(); ctx.translate(canvas.width/2, canvas.height/2);

    // ARENA DRAWING (Matches MAP_RADIUS 470)
    const WALL_THICKNESS = 40;
    ctx.beginPath(); ctx.arc(0, 0, MAP_RADIUS + WALL_THICKNESS, 0, Math.PI*2);
    ctx.fillStyle = '#555'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = '#222'; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, MAP_RADIUS, 0, Math.PI*2);
    ctx.fillStyle = '#C2B280'; ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = '#8B4513'; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 80, 0, Math.PI*2);
    ctx.strokeStyle = 'rgba(139, 69, 19, 0.2)'; ctx.lineWidth = 10; ctx.stroke();

    // --- BLOOD PARTICLES ---
    for (let i = bloodParticles.length - 1; i >= 0; i--) {
        let p = bloodParticles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.3; // gravity
        p.life--;

        ctx.fillStyle = `rgba(180,0,0,${Math.max(0, p.life/30)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();

        if (p.life <= 0) bloodParticles.splice(i, 1);
    }

    // --- DRAW HEALTH DROPS ---
    for (let id in healthDrops) {
        let d = healthDrops[id];
        ctx.drawImage(healthImg, d.x - 20, d.y - 20, 40, 40);
    }

    for (let id in players) {
        const p = players[id];
        if (!playerAnimState[id]) playerAnimState[id] = { action: 'IDLE', frame: 0, timer: 0 };
        const animState = playerAnimState[id];
        
        const currentAction = getPlayerAction(p, animState);
        if (currentAction !== animState.action) {
            if (currentAction === 'ATTACK' && id !== myId) playSound(attackSfx);
            animState.action = currentAction; animState.frame = 0; animState.timer = 0;
        }

        if (id === myId) {
            if (animState.action === 'RUN') { if (runSfx.paused) runSfx.play().catch(e=>{}); } 
            else { if (!runSfx.paused) { runSfx.pause(); runSfx.currentTime = 0; } }
        }

        const animConfig = ANIMATIONS[animState.action];
        animState.timer++;
        if (animState.timer >= animConfig.speed) {
            animState.frame++; animState.timer = 0;
            if (animState.frame >= animConfig.maxFrames) {
                animState.frame = (animState.action === 'DEATH') ? animConfig.maxFrames - 1 : 0;
                if(animState.action === 'ATTACK' || animState.action === 'HIT') animState.action = 'IDLE';
            }
        }

        const isLookingLeft = Math.abs(p.angle) > Math.PI/2;
        ctx.save(); ctx.translate(p.x, p.y);
        ctx.save(); if (isLookingLeft) ctx.scale(-1, 1); 
        ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(0, 14, 12, 6, 0, 0, Math.PI*2); ctx.fill();
        const srcX = animState.frame * SPRITE_SIZE; const srcY = animConfig.row * SPRITE_SIZE;
        try { ctx.drawImage(spriteSheet, srcX, srcY, SPRITE_SIZE, SPRITE_SIZE, -DRAW_SIZE/2, -DRAW_SIZE/2, DRAW_SIZE, DRAW_SIZE); } catch (e) {}
        ctx.restore(); 

        // Aim arrow
        ctx.save(); ctx.rotate(p.angle); 
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'; ctx.beginPath(); ctx.moveTo(30, -5); ctx.lineTo(50, 0); ctx.lineTo(30, 5); ctx.fill();
        ctx.restore();

        // HP bar & name
        ctx.fillStyle = 'red'; ctx.fillRect(-20, -45, 40, 5);
        ctx.fillStyle = '#0f0'; ctx.fillRect(-20, -45, 40 * (p.hp / 100), 5);
        ctx.fillStyle = (id === myId) ? '#FFD700' : 'white'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center'; ctx.fillText(p.name, 0, -55); 

        // If this was dead and has respawn timer, show countdown above corpse
        if (p.hp <= 0 && respawnTimers[id]) {
            let secLeft = Math.ceil((respawnTimers[id] - Date.now()) / 1000);
            if (secLeft > 0) {
                ctx.fillStyle = "white";
                ctx.font = "bold 18px Arial";
                ctx.textAlign = "center";
                ctx.fillText(`Respawn in ${secLeft}`, 0, -80);
            }
        }

        // If this is ME and I have personal respawn, show larger timer
        if (id === myId && p.hp <= 0 && myRespawnEnd) {
            let secLeft = Math.ceil((myRespawnEnd - Date.now()) / 1000);
            if (secLeft > 0) {
                ctx.fillStyle = "white";
                ctx.font = "bold 30px Arial";
                ctx.textAlign = "center";
                ctx.fillText(`Respawning in ${secLeft}`, 0, -100);
            }
        }

        ctx.restore(); 
    }

    if (winnerText !== "") {
        ctx.save();
        ctx.fillStyle = "rgba(0, 0, 0, 0.7)"; ctx.fillRect(-canvas.width/2, -canvas.height/2, canvas.width, canvas.height);
        ctx.fillStyle = "gold"; ctx.font = "bold 60px Arial"; ctx.textAlign = "center"; ctx.fillText(winnerText, 0, 0);
        ctx.fillStyle = "white"; ctx.font = "20px Arial"; ctx.fillText("Resetting Arena...", 0, 50);
        ctx.restore();
    }
    ctx.restore();
}
draw();
