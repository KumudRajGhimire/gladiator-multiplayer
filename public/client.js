const socket = io();
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const MAP_RADIUS = 470; 
const ATTACK_COOLDOWN = 400; 

ctx.imageSmoothingEnabled = false; 
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

window.oncontextmenu = (e) => { e.preventDefault(); }

// --- ASSETS ---
const spriteSheet = new Image(); spriteSheet.src = '/sprites.png';
const runSfx = new Audio('/run.wav'); runSfx.loop = true; runSfx.volume = 0.5; 
const attackSfx = new Audio('/attack.wav'); attackSfx.volume = 0.6;
const hitSfx = new Audio('/hit.wav'); hitSfx.volume = 0.8;
const bgMusic = new Audio('/bg.mp3'); bgMusic.loop = true; bgMusic.volume = 0.3;

// --- STATE ---
let players = {};
let myId = null;
let gameActive = false;
let playerAnimState = {}; 
let winnerText = "";
let bloodParticles = [];
let healthDrops = {};
let respawnTimers = {};
let myRespawnEnd = null;
let damagePopups = [];
let lastAttackTime = 0; 

// --- CROWD SYSTEM (NEW) ---
let crowd = [];
function initCrowd() {
    // Generate 150 spectators
    for (let i = 0; i < 150; i++) {
        const angle = Math.random() * Math.PI * 2;
        // Place them outside the wall (Radius 470 + 50 buffer)
        const dist = MAP_RADIUS + 55 + Math.random() * 100; 
        crowd.push({
            x: Math.cos(angle) * dist,
            y: Math.sin(angle) * dist,
            color: `hsl(${Math.random() * 360}, 20%, 50%)`, // Random bright colors
            offset: Math.random() * Math.PI * 2, // Random jump timing
            size: 10 + Math.random() * 4
        });
    }
}
initCrowd(); // Create them immediately

// --- LOGIN ---
function joinGame() {
    const name = document.getElementById('usernameInput').value || "Gladiator";
    const room = document.getElementById('roomInput').value || "global";
    socket.emit('joinGame', { name: name, room: room });
    document.getElementById('start-screen').style.display = 'none';
    document.getElementById('ui-layer').style.display = 'block';
    document.getElementById('displayRoom').innerText = room;
    runSfx.play().then(() => runSfx.pause());
    bgMusic.play().catch(e => console.log("Music blocked"));
}

// --- NETWORK ---
socket.on('connect', () => { myId = socket.id; });
socket.on('gameJoined', () => { gameActive = true; });
socket.on('update', (serverPlayers) => {
    players = serverPlayers;
    updateScoreboard();
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
        if (players[data.id] && data.dmg) {
            damagePopups.push({ x: players[data.id].x, y: players[data.id].y - 30, val: data.dmg, life: 30 });
        }
    }
});
socket.on('bloodEffect', (data) => { spawnBlood(data.x, data.y); });
socket.on('healthDropsUpdate', (drops) => { healthDrops = drops || {}; });
socket.on('respawnTimer', (msLeft) => { myRespawnEnd = Date.now() + msLeft; });
socket.on('playerDied', (data) => {
    spawnBlood(data.x, data.y);
    respawnTimers[data.id] = Date.now() + data.respawnIn;
});
socket.on('playerRespawned', (data) => {
    delete respawnTimers[data.id];
    if (data.id === myId) myRespawnEnd = null;
});
socket.on('gameOver', (winnerName) => {
    winnerText = `${winnerName} WINS!`;
    playSound(hitSfx);
    setTimeout(() => { winnerText = ""; }, 5000);
});

// --- CONTROLS ---
let keys = { w: false, a: false, s: false, d: false, shift: false };
window.addEventListener('keydown', (e) => {
    if (!gameActive) return;
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
        const now = Date.now();
        if (now - lastAttackTime >= ATTACK_COOLDOWN) {
            lastAttackTime = now;
            socket.emit('attack');
            if (playerAnimState[myId]) {
                playerAnimState[myId].action = 'ATTACK'; playerAnimState[myId].frame = 0;
            }
        }
    }
});

// --- HELPERS ---
function playSound(audio) {
    const clone = audio.cloneNode(); clone.volume = audio.volume; clone.play().catch(e => {});
}
function updateScoreboard() {
    if (!myId || !players[myId]) return;
    const p = players[myId];
    document.getElementById('scoreboard').innerText = `${p.name} | HP: ${Math.floor(p.hp)} | Kills: ${p.score}`;
}
function spawnBlood(x, y) {
    for (let i = 0; i < 18; i++) {
        bloodParticles.push({
            x: x + (Math.random()-0.5)*8, y: y + (Math.random()-0.5)*8,
            vx: (Math.random() - 0.5) * 6, vy: (Math.random() - 0.5) * 6,
            life: 18 + Math.random() * 12, size: 2 + Math.random() * 3
        });
    }
}
function drawPotion(x, y) {
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = "#ff4444"; ctx.beginPath(); ctx.arc(0, 6, 8, 0, Math.PI*2); ctx.fill();
    ctx.strokeStyle = "white"; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = "#eee"; ctx.fillRect(-4, -10, 8, 8);
    ctx.restore();
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
    if (Math.abs(p.vx) > 1 || Math.abs(p.vy) > 1) return 'RUN'; 
    return 'IDLE';
}

function draw() {
    requestAnimationFrame(draw);
    if (!gameActive) return;

    ctx.fillStyle = '#111'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.save(); ctx.translate(canvas.width/2, canvas.height/2);

    // --- NEW: DRAW CROWD (Bottom Layer) ---
    // We draw this BEFORE the wall so they look like they are "behind" it
    const time = Date.now() * 0.01; // Animation time
    for (let c of crowd) {
        // Bob up and down
        const jump = Math.sin(time + c.offset) * 5; 
        ctx.fillStyle = c.color;
        ctx.beginPath(); ctx.arc(c.x, c.y + jump, c.size, 0, Math.PI*2); ctx.fill();
    }
    // --------------------------------------

    // ARENA WALLS & FLOOR
    const WALL_THICKNESS = 40;
    ctx.beginPath(); ctx.arc(0, 0, MAP_RADIUS + WALL_THICKNESS, 0, Math.PI*2);
    ctx.fillStyle = '#555'; ctx.fill(); ctx.lineWidth = 4; ctx.strokeStyle = '#222'; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, MAP_RADIUS, 0, Math.PI*2);
    ctx.fillStyle = '#C2B280'; ctx.fill(); ctx.lineWidth = 6; ctx.strokeStyle = '#8B4513'; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 80, 0, Math.PI*2);
    ctx.strokeStyle = 'rgba(139, 69, 19, 0.2)'; ctx.lineWidth = 10; ctx.stroke();

    // PARTICLES
    for (let i = bloodParticles.length - 1; i >= 0; i--) {
        let p = bloodParticles[i];
        p.x += p.vx; p.y += p.vy; p.vy += 0.3; p.life--;
        ctx.fillStyle = `rgba(180,0,0,${Math.max(0, p.life/30)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
        if (p.life <= 0) bloodParticles.splice(i, 1);
    }

    // ITEMS
    for (let id in healthDrops) { let d = healthDrops[id]; drawPotion(d.x, d.y); }

    // PLAYERS
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

        if (p.hp > 0) {
            ctx.save(); ctx.rotate(p.angle); 
            ctx.fillStyle = 'rgba(255, 255, 255, 0.3)'; ctx.beginPath(); ctx.moveTo(30, -5); ctx.lineTo(50, 0); ctx.lineTo(30, 5); ctx.fill();
            ctx.restore();
            ctx.fillStyle = 'red'; ctx.fillRect(-20, -45, 40, 5);
            ctx.fillStyle = '#0f0'; ctx.fillRect(-20, -45, 40 * (p.hp / 100), 5);
            ctx.fillStyle = (id === myId) ? '#FFD700' : 'white'; ctx.font = 'bold 12px Arial'; ctx.textAlign = 'center'; ctx.fillText(p.name, 0, -55); 
        }

        if (p.hp <= 0 && respawnTimers[id]) {
            let secLeft = Math.ceil((respawnTimers[id] - Date.now()) / 1000);
            if (secLeft > 0) {
                ctx.fillStyle = "white"; ctx.font = "bold 18px Arial"; ctx.textAlign = "center";
                ctx.fillText(`Respawn: ${secLeft}`, 0, -80);
            }
        }
        ctx.restore(); 
    }

    // DAMAGE POPUPS
    for (let i = damagePopups.length - 1; i >= 0; i--) {
        const pop = damagePopups[i];
        ctx.save(); ctx.fillStyle = pop.val > 25 ? 'red' : 'white'; 
        ctx.font = pop.val > 25 ? 'bold 24px Arial' : 'bold 16px Arial';
        ctx.textAlign = 'center'; ctx.fillText(pop.val, pop.x, pop.y); ctx.restore();
        pop.y -= 1; pop.life--; 
        if (pop.life <= 0) damagePopups.splice(i, 1);
    }

    // DEAD OVERLAY
    if (myRespawnEnd) {
         let secLeft = Math.ceil((myRespawnEnd - Date.now()) / 1000);
         if (secLeft > 0) {
            ctx.save();
            ctx.fillStyle = "rgba(100, 0, 0, 0.3)"; ctx.fillRect(-canvas.width/2, -canvas.height/2, canvas.width, canvas.height);
            ctx.fillStyle = "white"; ctx.font = "bold 40px Arial"; ctx.textAlign = "center";
            ctx.fillText(`YOU DIED`, 0, -20);
            ctx.font = "20px Arial";
            ctx.fillText(`Respawning in ${secLeft}...`, 0, 30);
            ctx.restore();
         }
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