const socket = io();

let myId = '';
let roomId = '';
let username = '';
let isHost = false;
let roomState = null;
let wakeLock = null; 

let titleInterval = null;
const originalTitle = document.title;

let isMiniMode = false;

if (window.electronAPI) {
    document.getElementById('customTitlebar').style.display = 'flex';
} else {
    document.getElementById('customTitlebar').style.display = 'none';
}

document.getElementById('inputUsername').value = localStorage.getItem('timer_pro_username') || '';
document.getElementById('inputRoomId').value = localStorage.getItem('timer_pro_roomid') || '';

if ('Notification' in window) {
    if (Notification.permission !== 'granted' && Notification.permission !== 'denied') {
        Notification.requestPermission();
    }
}

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (err) {}
}

function releaseWakeLock() {
    if (wakeLock !== null) {
        wakeLock.release();
        wakeLock = null;
    }
}

function playAlarmBeep() {
    if (roomState && !roomState.soundEnabled) return;
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = 460;
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.8);
    } catch (e) {}
}

function playSoftNotificationBeep() {
    if (roomState && !roomState.soundEnabled) return;
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 580;
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.15);
    } catch (e) {}
}

function startFlashingTitle() {
    if (titleInterval) clearInterval(titleInterval);
    let toggle = false;
    titleInterval = setInterval(() => {
        document.title = toggle ? "⚠ TIME'S UP! ⚠" : originalTitle;
        toggle = !toggle;
    }, 1000);
}

function stopFlashingTitle() {
    if (titleInterval) {
        clearInterval(titleInterval);
        titleInterval = null;
    }
    document.title = originalTitle;
}

window.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
        e.preventDefault();
        if (!isMiniMode) {
            document.getElementById('sidebar').classList.toggle('collapsed');
        }
    }
});

function joinRoom() {
    username = document.getElementById('inputUsername').value.trim();
    let rId = document.getElementById('inputRoomId').value.trim().toUpperCase();

    if (!username) { alert("Please enter your name!"); return; }
    
    if (!rId) {
        roomId = 'ROOM_' + Math.random().toString(36).substr(2, 5).toUpperCase();
        isHost = true;
    } else {
        roomId = rId;
        isHost = false;
    }

    localStorage.setItem('timer_pro_username', username);
    localStorage.setItem('timer_pro_roomid', roomId);

    myId = socket.id;
    socket.emit('join-room', { roomId, username, isHost });

    document.getElementById('screenJoin').style.display = 'none';
    document.getElementById('screenMain').style.display = 'flex';
    document.getElementById('lblRoomId').innerText = roomId;

    setupHostConfigListeners();
}

function setupHostConfigListeners() {
    if (!isHost) return;
    document.getElementById('hostConfig').style.display = 'block';
    document.getElementById('lobbyUserStatus').style.display = 'none';

    document.getElementById('checkNotifyAll').addEventListener('change', (e) => {
        socket.emit('set-sync-notification', e.target.checked);
    });

    document.getElementById('checkSound').addEventListener('change', (e) => {
        socket.emit('set-sound', e.target.checked);
    });

    const checkAutoSync = document.getElementById('checkAutoSync');
    const autoSyncPathGroup = document.getElementById('autoSyncPathGroup');
    const inputAutoSyncPath = document.getElementById('inputAutoSyncPath');

    inputAutoSyncPath.value = localStorage.getItem('timer_pro_autosync_path') || '';

    checkAutoSync.addEventListener('change', () => {
        autoSyncPathGroup.style.display = checkAutoSync.checked ? 'block' : 'none';
        socket.emit('set-auto-sync', checkAutoSync.checked);
    });

    inputAutoSyncPath.addEventListener('input', () => {
        localStorage.setItem('timer_pro_autosync_path', inputAutoSyncPath.value.trim());
    });

    const checkAccumulate = document.getElementById('checkAccumulate');
    const maxAccumulateGroup = document.getElementById('maxAccumulateGroup');
    const inputMaxAccumulate = document.getElementById('inputMaxAccumulate');

    checkAccumulate.addEventListener('change', () => {
        const isEnabled = checkAccumulate.checked;
        maxAccumulateGroup.style.display = isEnabled ? 'block' : 'none';
        socket.emit('set-accumulate', { enabled: isEnabled, maxSec: parseInt(inputMaxAccumulate.value) || 30 });
    });

    inputMaxAccumulate.addEventListener('input', () => {
        socket.emit('set-accumulate', { enabled: checkAccumulate.checked, maxSec: parseInt(inputMaxAccumulate.value) || 30 });
    });
}

socket.on('update-room', (state) => {
    roomState = state;
    renderPlayerList();
});

socket.on('update-sound', (enabled) => {
    if (isHost) return;
    document.getElementById('checkSound').checked = enabled;
});

socket.on('update-sync-notification', (enabled) => {
    if (isHost) return;
    document.getElementById('checkNotifyAll').checked = enabled;
});

socket.on('update-auto-sync', (enabled) => {
    if (isHost) return;
    document.getElementById('checkAutoSync').checked = enabled;
});

socket.on('update-accumulate', (data) => {
    if (isHost) return;
    document.getElementById('checkAccumulate').checked = data.enabled;
    document.getElementById('maxAccumulateGroup').style.display = data.enabled ? 'block' : 'none';
    document.getElementById('inputMaxAccumulate').value = data.maxSec;
});

function renderPlayerList() {
    const container = document.getElementById('playerListContainer');
    container.innerHTML = '';

    roomState.players.forEach((player, idx) => {
        const item = document.createElement('div');
        item.className = 'player-item';
        if (roomState.status === 'playing' && idx === roomState.activePlayerIndex) {
            item.classList.add('active-turn');
        }

        const bonusText = roomState.accumulateUnused && player.timeBank > 0 ? ` (+${player.timeBank}s)` : '';

        item.innerHTML = `
            <span>${idx + 1}. ${player.name} ${player.id === socket.id ? '(You)' : ''} <span style="color:#ffcc00; font-weight:bold;">${bonusText}</span></span>
            ${player.isHost ? '<span class="badge">Host</span>' : ''}
        `;

        if (roomState.status === 'lobby' && isHost) {
            item.setAttribute('draggable', 'true');
            setupDragAndDropEvents(item, player.id);
        }

        container.appendChild(item);
    });
}

let dragSrcId = null;
function setupDragAndDropEvents(element, playerId) {
    element.addEventListener('dragstart', (e) => {
        element.classList.add('dragging');
        dragSrcId = playerId;
        e.dataTransfer.effectAllowed = 'move';
    });

    element.addEventListener('dragover', (e) => { e.preventDefault(); });

    element.addEventListener('drop', (e) => {
        e.preventDefault();
        const targetId = playerId;
        if (dragSrcId !== targetId) {
            const playerIds = roomState.players.map(p => p.id);
            const srcIdx = playerIds.indexOf(dragSrcId);
            const targetIdx = playerIds.indexOf(targetId);

            playerIds.splice(srcIdx, 1);
            playerIds.splice(targetIdx, 0, dragSrcId);

            socket.emit('reorder-players', playerIds);
        }
    });

    element.addEventListener('dragend', () => {
        element.classList.remove('dragging');
    });
}

function hostStartGame() {
    const duration = parseInt(document.getElementById('inputDuration').value) || 45;
    socket.emit('start-game', duration);
}

socket.on('game-started', (state) => {
    roomState = state;
    document.getElementById('lobbyView').style.display = 'none';
    document.getElementById('statsView').style.display = 'none';
    document.getElementById('gameView').style.display = 'block';
    
    if (window.electronAPI) {
        document.getElementById('btnMiniToggle').style.display = 'block';

        const checkAutoSync = document.getElementById('checkAutoSync');
        const inputAutoSyncPath = document.getElementById('inputAutoSyncPath');

        if (isHost && checkAutoSync && checkAutoSync.checked && inputAutoSyncPath.value.trim()) {
            window.electronAPI.startWatching(inputAutoSyncPath.value.trim());
        }
    }

    if (isHost) {
        document.getElementById('btnHostPause').style.display = 'block';
        document.getElementById('btnHostEndGame').style.display = 'block';
    } else {
        document.getElementById('btnHostPause').style.display = 'none';
        document.getElementById('btnHostEndGame').style.display = 'none';
    }

    requestWakeLock();
});

if (window.electronAPI) {
    window.electronAPI.onAutoSync((filename) => {
        console.log(`[Auto-Sync Event] Chuyển lượt tự động do phát hiện file đổi: ${filename}`);
        clientEndTurn(); 
    });
}

socket.on('start-countdown', (data) => {
    roomState.activePlayerIndex = data.activePlayerIndex;
    
    const activePlayer = roomState.players[data.activePlayerIndex];
    document.getElementById('activePlayerName').innerText = activePlayer.name;

    const badge = document.getElementById('bonusTimeBadge');
    if (roomState.accumulateUnused && data.timeBank > 0) {
        badge.style.display = 'inline-block';
        badge.innerText = `Time Bank: +${data.timeBank}s`;
    } else {
        badge.style.display = 'none';
    }

    renderPlayerList();
    updateTimerUI(data.duration, data.paused);

    const btnExtend = document.getElementById('btnExtend');
    btnExtend.disabled = false;
    btnExtend.style.opacity = '1';
    btnExtend.innerText = "➕ 15s EXTRA";

    const btnEndTurn = document.getElementById('btnEndTurn');
    if (activePlayer.id === socket.id) {
        btnEndTurn.disabled = false;
        btnEndTurn.style.opacity = '1';
    } else {
        btnEndTurn.disabled = true;
        btnEndTurn.style.opacity = '0.3';
    }
});

socket.on('timer-tick', (data) => {
    updateTimerUI(data.timeLeft, data.paused);
});

function updateTimerUI(timeLeft, paused) {
    const timerDisplay = document.getElementById('timerDisplay');
    timerDisplay.innerText = timeLeft < 10 ? `0${timeLeft}` : timeLeft;

    if (timeLeft <= 10) {
        timerDisplay.classList.add('warning');
    } else {
        timerDisplay.classList.remove('warning');
    }

    if (paused) {
        timerDisplay.classList.add('paused');
        document.getElementById('btnHostPause').innerText = "RESUME";
    } else {
        timerDisplay.classList.remove('paused');
        document.getElementById('btnHostPause').innerText = "PAUSE";
    }
}

socket.on('on-deck-alert', (currentPlayerName) => {
    playSoftNotificationBeep(); 

    if ('Notification' in window && Notification.permission === 'granted') {
        new Notification("GET READY!", {
            body: `You are next in turn! [ ${currentPlayerName} ] has only 10s left.`,
            silent: true 
        });
    }
});

socket.on('time-out-alarm', (data) => {
    playAlarmBeep();
    
    const overlay = document.getElementById('alarmOverlay');
    const activePlayer = roomState.players[roomState.activePlayerIndex];

    document.getElementById('alarmMessage').innerText = `Turn time for [ ${data.activePlayerName} ] has expired!`;
    overlay.style.display = 'flex';

    if (activePlayer.id === socket.id) {
        document.getElementById('btnAlarmNext').style.display = 'block';
        document.getElementById('btnAlarmOK').style.display = 'none';
    } else {
        document.getElementById('btnAlarmNext').style.display = 'none';
        document.getElementById('btnAlarmOK').style.display = 'block';
    }

    startFlashingTitle(); 

    if ('Notification' in window && Notification.permission === 'granted') {
        const notification = new Notification("TIME'S UP!", {
            body: `Turn time for [ ${data.activePlayerName} ] has expired! Click here to return.`,
            requireInteraction: true 
        });

        notification.onclick = function() {
            window.focus(); 
            notification.close();
            stopFlashingTitle();
        };
    }
});

socket.on('close-alarm-overlay', () => {
    document.getElementById('alarmOverlay').style.display = 'none';
    stopFlashingTitle();
});

socket.on('extension-applied', (usedCount) => {
    const btnExtend = document.getElementById('btnExtend');
    if (usedCount >= 2) {
        btnExtend.disabled = true;
        btnExtend.style.opacity = '0.3';
        btnExtend.innerText = "➕ MAX LIMIT";
    } else {
        btnExtend.innerText = `➕ 15s EXTRA (${usedCount}/2)`;
    }
});

function requestExtension() {
    const activePlayer = roomState.players[roomState.activePlayerIndex];
    if (activePlayer && activePlayer.id === socket.id) {
        socket.emit('request-extension');
    }
}

function hostEndGame() {
    if (isHost && confirm("End game and view scoreboard?")) {
        socket.emit('end-game');
    }
}

socket.on('show-stats', (statsData) => {
    document.getElementById('lobbyView').style.display = 'none';
    document.getElementById('gameView').style.display = 'none';
    document.getElementById('statsView').style.display = 'block';

    if (isMiniMode) {
        toggleMiniLayout();
    }

    releaseWakeLock();

    let thinker = statsData[0];
    let runner = statsData[0];

    statsData.forEach(p => {
        if (p.avgTime > thinker.avgTime) thinker = p;
        if (p.avgTime < runner.avgTime) runner = p;
    });

    document.getElementById('thinkerName').innerText = thinker.name;
    document.getElementById('speedName').innerText = runner.name;

    const table = document.getElementById('statsTable');
    table.innerHTML = `
        <div class="stats-row-header">
            <span>Player</span>
            <span>Turns</span>
            <span>Total Time</span>
            <span>Avg Time</span>
        </div>
    `;

    statsData.forEach(p => {
        table.innerHTML += `
            <div class="stats-row">
                <span>${p.name}</span>
                <span>${p.turns}</span>
                <span>${p.totalTime}s</span>
                <span style="color:#00ffcc; font-weight:bold;">${p.avgTime}s/turn</span>
            </div>
        `;
    });
});

function backToLobby() {
    document.getElementById('statsView').style.display = 'none';
    document.getElementById('lobbyView').style.display = 'block';
    isGameStarted = false;
    socket.emit('join-room', { roomId, username, isHost });
}

function leaveLobby() {
    if (confirm("Are you sure you want to leave this lobby?")) {
        if (window.electronAPI) {
            window.electronAPI.stopWatching();
        }

        socket.emit('leave-room'); 
        socket.disconnect();
        socket.connect(); 
        
        isGameStarted = false;
        trace = [];

        document.getElementById('screenMain').style.display = 'none';
        document.getElementById('screenJoin').style.display = 'block';
        
        if (isMiniMode) {
            toggleMiniLayout();
        }
    }
}

function togglePause() {
    if (isHost) socket.emit('toggle-pause');
}

function exitAlarmAndNext() {
    stopFlashingTitle();
    document.getElementById('alarmOverlay').style.display = 'none';
    socket.emit('end-turn');
}

function exitAlarmOK() {
    stopFlashingTitle();
    document.getElementById('alarmOverlay').style.display = 'none';
}

function clientEndTurn() {
    socket.emit('end-turn');
}

function appMinimize() {
    if (window.electronAPI) window.electronAPI.minimizeApp();
}

function appClose() {
    if (confirm("Are you sure you want to exit the application?")) {
        releaseWakeLock();
        if (window.electronAPI) {
            window.electronAPI.stopWatching();
            window.electronAPI.closeApp();
        }
        else window.close();
    }
}

function toggleMiniLayout() {
    if (!window.electronAPI) return;
    
    isMiniMode = !isMiniMode;
    const body = document.body;
    const btnMini = document.getElementById('btnMiniToggle');
    const sidebar = document.getElementById('sidebar');

    if (isMiniMode) {
        body.classList.add('mini-active');
        sidebar.classList.add('collapsed');
        btnMini.innerText = "NORMAL WINDOW";
        window.electronAPI.toggleMini(true);
    } else {
        body.classList.remove('mini-active');
        sidebar.classList.remove('collapsed');
        btnMini.innerText = "MINI WINDOW";
        window.electronAPI.toggleMini(false);
    }
}

function exitGame() {
    if (confirm("Are you sure you want to exit the room?")) {
        releaseWakeLock(); 
        if (window.electronAPI) {
            window.electronAPI.stopWatching();
        }
        socket.disconnect();
        window.location.href = window.location.pathname;
    }
}