
/* =========================================
   GROOVEKIT STUDIO
   Recording, drum sounds, timeline editing,
   snap-to-grid, quantize, undo, and redo.
   ========================================= */

// Every instrument has its own timeline track and keyboard shortcut.
const INSTRUMENTS = [
  { id: "kick", name: "Kick", key: "A", color: "#a78bfa", description: "Deep bass drum" },
  { id: "snare", name: "Snare", key: "D", color: "#ff718d", description: "Punchy snare" },
  { id: "closed-hat", name: "Closed Hat", key: "G", color: "#fbbf24", description: "Short hi-hat" },
  { id: "ride", name: "Ride", key: "S", color: "#60a5fa", description: "Bright cymbal" },
  { id: "tom", name: "Tom", key: "F", color: "#fb923c", description: "Low tom drum" },
  { id: "clap", name: "Clap", key: "Q", color: "#f472b6", description: "Hand clap" },
  { id: "open-hat", name: "Open Hat", key: "W", color: "#2dd4bf", description: "Open hi-hat" },
  { id: "rimshot", name: "Rimshot", key: "E", color: "#c084fc", description: "Sharp rim click" },
  { id: "shaker", name: "Shaker", key: "R", color: "#a3e635", description: "Shaking percussion" },
  { id: "crash", name: "Crash", key: "T", color: "#f87171", description: "Crash cymbal" },
  { id: "cowbell", name: "Cowbell", key: "Y", color: "#38bdf8", description: "Metallic cowbell" },
  { id: "percussion", name: "Percussion", key: "U", color: "#e879f9", description: "Extra percussion" }
];

// Main application settings.
const state = {
  tempo: 110,
  bars: 8,
  masterVolume: 0.8,
  snap: 0.5,
  isPlaying: false,
  isRecording: false,
  playheadBeat: 0,
  previousBeat: 0,
  selectedTrack: "kick",
  selectedHit: null,
  tracks: {},
  nextHitId: 1,
  timer: null,
  lastTickTime: 0,
  audio: null,
  masterGain: null,
  undoStack: [],
  redoStack: [],
  maxHistory: 60
};

const BEATS_PER_BAR = 4;
const BEAT_WIDTH = 22;
const LABEL_WIDTH = 230;

const $ = (id) => document.getElementById(id);

const recordButton = $("record-button");
const playButton = $("play-button");
const stopButton = $("stop-button");
const tempoInput = $("tempo");
const tempoValue = $("tempo-value");
const loopLength = $("loop-length");
const masterVolume = $("master-volume");
const masterValue = $("master-value");
const transportStatus = $("transport-status");
const positionDisplay = $("position-display");
const trackList = $("track-list");
const drumPads = $("drum-pads");
const timelineRuler = $("timeline-ruler");
const timelineContent = $("timeline-content");
const timelineScroll = $("timeline-scroll");
const playhead = $("playhead");
const selectedTrackSelect = $("selected-track");
const snapGrid = $("snap-grid");
const quantizeButton = $("quantize-button");
const undoButton = $("undo-button");
const redoButton = $("redo-button");
const clearButton = $("clear-button");

// Create an empty track for each instrument.
INSTRUMENTS.forEach((instrument) => {
  state.tracks[instrument.id] = {
    hits: [],
    volume: 0.8,
    muted: false,
    solo: false
  };
});

// The length of the loop, measured in beats.
function getLoopBeats() {
  return state.bars * BEATS_PER_BAR;
}

// Convert a beat position to a horizontal pixel position.
function beatToPixels(beat) {
  return beat * BEAT_WIDTH;
}

// Keep beats inside the current loop.
function clampBeat(beat) {
  return Math.max(0, Math.min(getLoopBeats() - 0.001, beat));
}

// Snap a beat position to the selected grid size.
function snapBeat(beat) {
  const grid = Number(state.snap) || 0.5;
  return clampBeat(Math.round(beat / grid) * grid);
}

// Generate unique IDs for drum hits.
function createHit(beat) {
  return {
    id: state.nextHitId++,
    beat: clampBeat(beat)
  };
}

/* =========================================
   AUDIO ENGINE
   Sounds are generated directly in the browser.
   No external audio files are required.
   ========================================= */

function initAudio() {
  if (state.audio) {
    if (state.audio.state === "suspended") {
      state.audio.resume();
    }
    return;
  }

  const AudioContextClass =
    window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    setStatus("Your browser does not support Web Audio.");
    return;
  }

  state.audio = new AudioContextClass();
  state.masterGain = state.audio.createGain();
  state.masterGain.gain.value = state.masterVolume;
  state.masterGain.connect(state.audio.destination);
}

function makeGain(volume, destination = state.masterGain) {
  const gain = state.audio.createGain();
  gain.gain.value = volume;
  gain.connect(destination);
  return gain;
}

function playOscillator({
  frequency = 440,
  endFrequency = frequency,
  type = "sine",
  duration = 0.15,
  volume = 0.5,
  when = state.audio.currentTime,
  destination = state.masterGain
}) {
  const oscillator = state.audio.createOscillator();
  const gain = state.audio.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, when);

  if (endFrequency !== frequency) {
    oscillator.frequency.exponentialRampToValueAtTime(
      Math.max(1, endFrequency),
      when + duration
    );
  }

  gain.gain.setValueAtTime(Math.max(0.0001, volume), when);
  gain.gain.exponentialRampToValueAtTime(
    0.0001,
    when + Math.max(0.025, duration)
  );

  oscillator.connect(gain);
  gain.connect(destination);
  oscillator.start(when);
  oscillator.stop(when + duration + 0.02);
}

function playNoise({
  duration = 0.12,
  volume = 0.3,
  filterFrequency = 9000,
  when = state.audio.currentTime,
  destination = state.masterGain
}) {
  const sampleCount = Math.max(
    1,
    Math.floor(state.audio.sampleRate * duration)
  );

  const buffer = state.audio.createBuffer(
    1,
    sampleCount,
    state.audio.sampleRate
  );

  const channel = buffer.getChannelData(0);

  for (let i = 0; i < sampleCount; i++) {
    channel[i] = Math.random() * 2 - 1;
  }

  const source = state.audio.createBufferSource();
  const filter = state.audio.createBiquadFilter();
  const gain = state.audio.createGain();

  source.buffer = buffer;
  filter.type = "highpass";
  filter.frequency.value = filterFrequency;

  gain.gain.setValueAtTime(volume, when);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);

  source.connect(filter);
  filter.connect(gain);
  gain.connect(destination);

  source.start(when);
  source.stop(when + duration + 0.02);
}

function playDrum(id, velocity = 1) {
  initAudio();
  if (!state.audio || !state.masterGain) return;

  const track = state.tracks[id];
  if (!track) return;

  const when = state.audio.currentTime;
  const volume = state.masterVolume * track.volume * velocity;

  if (volume <= 0) return;

  const output = makeGain(volume);
  const closeOutput = () => {
    // Nodes are allowed to finish their short sound naturally.
  };

  switch (id) {
    case "kick":
      playOscillator({
        frequency: 150,
        endFrequency: 42,
        type: "sine",
        duration: 0.34,
        volume: 0.95,
        when,
        destination: output
      });
      playOscillator({
        frequency: 900,
        endFrequency: 100,
        type: "triangle",
        duration: 0.025,
        volume: 0.14,
        when,
        destination: output
      });
      break;

    case "snare":
      playNoise({
        duration: 0.19,
        volume: 0.72,
        filterFrequency: 1200,
        when,
        destination: output
      });
      playOscillator({
        frequency: 190,
        endFrequency: 105,
        type: "triangle",
        duration: 0.12,
        volume: 0.45,
        when,
        destination: output
      });
      break;

    case "closed-hat":
      playNoise({
        duration: 0.055,
        volume: 0.52,
        filterFrequency: 7500,
        when,
        destination: output
      });
      break;

    case "ride":
      playNoise({
        duration: 0.42,
        volume: 0.34,
        filterFrequency: 5200,
        when,
        destination: output
      });
      [410, 610, 820].forEach((frequency) => {
        playOscillator({
          frequency,
          endFrequency: frequency * 0.99,
          type: "inharmonic",
          duration: 0.32,
          volume: 0.12,
          when,
          destination: output
        });
      });
      break;

    case "tom":
      playOscillator({
        frequency: 180,
        endFrequency: 75,
        type: "sine",
        duration: 0.28,
        volume: 0.85,
        when,
        destination: output
      });
      break;

    case "clap":
      [0, 0.025, 0.055].forEach((delay, index) => {
        playNoise({
          duration: 0.045,
          volume: index === 0 ? 0.45 : 0.28,
          filterFrequency: 1500,
          when: when + delay,
          destination: output
        });
      });
      break;

    case "open-hat":
      playNoise({
        duration: 0.36,
        volume: 0.4,
        filterFrequency: 6200,
        when,
        destination: output
      });
      break;

    case "rimshot":
      playNoise({
        duration: 0.045,
        volume: 0.5,
        filterFrequency: 2400,
        when,
        destination: output
      });
      playOscillator({
        frequency: 1100,
        endFrequency: 450,
        type: "triangle",
        duration: 0.06,
        volume: 0.25,
        when,
        destination: output
      });
      break;

    case "shaker":
      playNoise({
        duration: 0.085,
        volume: 0.28,
        filterFrequency: 6500,
        when,
        destination: output
      });
      break;

    case "crash":
      playNoise({
        duration: 0.95,
        volume: 0.45,
        filterFrequency: 3600,
        when,
        destination: output
      });
      break;

    case "cowbell":
      playOscillator({
        frequency: 540,
        endFrequency: 530,
        type: "square",
        duration: 0.19,
        volume: 0.16,
        when,
        destination: output
      });
      playOscillator({
        frequency: 815,
        endFrequency: 800,
        type: "square",
        duration: 0.19,
        volume: 0.13,
        when,
        destination: output
      });
      break;

    case "percussion":
      playOscillator({
        frequency: 380,
        endFrequency: 115,
        type: "triangle",
        duration: 0.14,
        volume: 0.55,
        when,
        destination: output
      });
      playNoise({
        duration: 0.055,
        volume: 0.2,
        filterFrequency: 1600,
        when,
        destination: output
      });
      break;
  }

  closeOutput();
}

/* =========================================
   UNDO / REDO
   Store snapshots of the drum-hit positions.
   ========================================= */

function snapshotHits() {
  return JSON.stringify({
    nextHitId: state.nextHitId,
    tracks: Object.fromEntries(
      INSTRUMENTS.map((instrument) => [
        instrument.id,
        state.tracks[instrument.id].hits.map((hit) => ({
          id: hit.id,
          beat: hit.beat
        }))
      ])
    )
  });
}

function restoreSnapshot(snapshot) {
  const data = JSON.parse(snapshot);

  state.nextHitId = data.nextHitId;

  INSTRUMENTS.forEach((instrument) => {
    state.tracks[instrument.id].hits =
      (data.tracks[instrument.id] || []).map((hit) => ({
        id: hit.id,
        beat: hit.beat
      }));
  });

  state.selectedHit = null;
  renderTracks();
  updateHistoryButtons();
}

function saveHistory() {
  state.undoStack.push(snapshotHits());

  if (state.undoStack.length > state.maxHistory) {
    state.undoStack.shift();
  }

  state.redoStack = [];
  updateHistoryButtons();
}

function undo() {
  if (!state.undoStack.length) return;

  state.redoStack.push(snapshotHits());
  const previous = state.undoStack.pop();

  restoreSnapshot(previous);
  setStatus("Undo complete");
}

function redo() {
  if (!state.redoStack.length) return;

  state.undoStack.push(snapshotHits());
  const next = state.redoStack.pop();

  restoreSnapshot(next);
  setStatus("Redo complete");
}

function updateHistoryButtons() {
  undoButton.disabled = state.undoStack.length === 0;
  redoButton.disabled = state.redoStack.length === 0;
}

/* =========================================
   BUILD THE INTERFACE
   Generate all 12 tracks and pads automatically.
   ========================================= */

function buildSelectedTrackOptions() {
  selectedTrackSelect.innerHTML = "";

  INSTRUMENTS.forEach((instrument) => {
    const option = document.createElement("option");
    option.value = instrument.id;
    option.textContent = `${instrument.name} (${instrument.key})`;
    selectedTrackSelect.appendChild(option);
  });

  selectedTrackSelect.value = state.selectedTrack;
}

function buildPads() {
  drumPads.innerHTML = "";

  INSTRUMENTS.forEach((instrument) => {
    const button = document.createElement("button");
    button.className = "drum-pad";
    button.type = "button";
    button.dataset.instrument = instrument.id;
    button.style.setProperty("--pad-color", instrument.color);
    button.setAttribute(
      "aria-label",
      `${instrument.name} drum pad. Keyboard shortcut ${instrument.key}`
    );

    button.innerHTML = `
      <span class="pad-name">${instrument.name}</span>
      <span class="pad-description">${instrument.description}</span>
      <span class="pad-key">${instrument.key}</span>
    `;

    button.addEventListener("click", () => {
      hitDrum(instrument.id);
    });

    drumPads.appendChild(button);
  });
}

function buildTimelineRuler() {
  timelineRuler.innerHTML = "";

  const totalBeats = getLoopBeats();
  const totalWidth = totalBeats * BEAT_WIDTH;

  timelineRuler.style.width = `${totalWidth}px`;

  for (let bar = 0; bar < state.bars; bar++) {
    const label = document.createElement("div");
    label.className = "bar-label";
    label.style.width = `${BEATS_PER_BAR * BEAT_WIDTH}px`;
    label.textContent = `BAR ${bar + 1}`;
    timelineRuler.appendChild(label);
  }
}

function updateTimelineWidth() {
  const totalWidth = getLoopBeats() * BEAT_WIDTH;

  timelineContent.style.width =
    `${LABEL_WIDTH + totalWidth}px`;

  timelineContent.style.minWidth =
    `${LABEL_WIDTH + totalWidth}px`;

  timelineContent.style.setProperty(
    "--beat-width",
    `${BEAT_WIDTH}px`
  );

  timelineContent.style.setProperty(
    "--label-width",
    `${LABEL_WIDTH}px`
  );

  playhead.style.left = `${LABEL_WIDTH}px`;
  buildTimelineRuler();
}

function renderTracks() {
  updateTimelineWidth();
  trackList.innerHTML = "";

  INSTRUMENTS.forEach((instrument) => {
    const track = state.tracks[instrument.id];

    const row = document.createElement("div");
    row.className = "track-row";
    row.dataset.track = instrument.id;

    if (state.selectedTrack === instrument.id) {
      row.classList.add("selected-track");
    }

    const controls = document.createElement("div");
    controls.className = "track-controls";

    const topLine = document.createElement("div");
    topLine.className = "track-topline";

    const color = document.createElement("span");
    color.className = "track-color";
    color.style.background = instrument.color;

    const nameButton = document.createElement("button");
    nameButton.className = "track-name-button";
    nameButton.type = "button";
    nameButton.textContent = instrument.name;
    nameButton.title = `Select ${instrument.name} track`;

    nameButton.addEventListener("click", () => {
      selectTrack(instrument.id);
    });

    const keyLabel = document.createElement("span");
    keyLabel.className = "track-key";
    keyLabel.textContent = instrument.key;

    topLine.append(color, nameButton, keyLabel);

    const mixer = document.createElement("div");
    mixer.className = "track-mixer";

    const muteButton = document.createElement("button");
    muteButton.className = "mixer-button";
    muteButton.type = "button";
    muteButton.textContent = "M";
    muteButton.title = "Mute track";

    if (track.muted) muteButton.classList.add("active-mute");

    muteButton.addEventListener("click", () => {
      track.muted = !track.muted;
      renderTracks();
    });

    const soloButton = document.createElement("button");
    soloButton.className = "mixer-button";
    soloButton.type = "button";
    soloButton.textContent = "S";
    soloButton.title = "Solo track";

    if (track.solo) soloButton.classList.add("active-solo");

    soloButton.addEventListener("click", () => {
      track.solo = !track.solo;
      renderTracks();
    });

    const volumeLabel = document.createElement("span");
    volumeLabel.className = "volume-label";
    volumeLabel.textContent = "VOL";

    const volume = document.createElement("input");
    volume.className = "track-volume";
    volume.type = "range";
    volume.min = "0";
    volume.max = "100";
    volume.value = String(Math.round(track.volume * 100));
    volume.setAttribute("aria-label", `${instrument.name} volume`);
    volume.title = `${instrument.name} volume`;

    volume.addEventListener("input", () => {
      track.volume = Number(volume.value) / 100;
    });

    mixer.append(muteButton, soloButton, volumeLabel, volume);
    controls.append(topLine, mixer);

    const lane = document.createElement("div");
    lane.className = "track-lane";
    lane.dataset.track = instrument.id;
    lane.style.width = `${getLoopBeats() * BEAT_WIDTH}px`;

    if (track.hits.length === 0) {
      const empty = document.createElement("span");
      empty.className = "empty-track-message";
      empty.textContent = "Play this instrument to add hits";
      lane.appendChild(empty);
    }

    track.hits.forEach((hit) => {
      const marker = document.createElement("button");
      marker.className = "track-hit";
      marker.type = "button";
      marker.dataset.hitId = String(hit.id);
      marker.dataset.track = instrument.id;
      marker.style.left = `${beatToPixels(hit.beat)}px`;
      marker.style.setProperty("--hit-color", instrument.color);
      marker.title =
        `${instrument.name} · Beat ${hit.beat.toFixed(2)}. Drag to move.`;

      marker.setAttribute(
        "aria-label",
        `${instrument.name} hit at beat ${hit.beat.toFixed(2)}. Drag to move it.`
      );

      if (
        state.selectedHit &&
        state.selectedHit.trackId === instrument.id &&
        state.selectedHit.hitId === hit.id
      ) {
        marker.classList.add("selected-hit");
      }

      attachDragHandlers(marker, lane, instrument.id, hit);
      marker.addEventListener("click", () => {
        state.selectedHit = {
          trackId: instrument.id,
          hitId: hit.id
        };
      });

      lane.appendChild(marker);
    });

    row.append(controls, lane);
    trackList.appendChild(row);
  });

  updatePlayheadDisplay();
}

/* =========================================
   SELECT TRACK AND HIT
   ========================================= */

function selectTrack(trackId) {
  state.selectedTrack = trackId;
  selectedTrackSelect.value = trackId;
  renderTracks();
}

function findHit(trackId, hitId) {
  return state.tracks[trackId].hits.find(
    (hit) => hit.id === hitId
  );
}

/* =========================================
   DRAG HITS ON THE TIMELINE
   The hit's beat position is its actual timing.
   ========================================= */

function attachDragHandlers(marker, lane, trackId, hit) {
  let dragging = false;
  let moved = false;
  let startX = 0;
  let originalBeat = hit.beat;
  let latestBeat = hit.beat;

  marker.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();

    initAudio();

    dragging = true;
    moved = false;
    startX = event.clientX;
    originalBeat = hit.beat;
    latestBeat = hit.beat;

    state.selectedHit = { trackId, hitId: hit.id };
    selectTrack(trackId);

    marker.classList.add("dragging");

    try {
      marker.setPointerCapture(event.pointerId);
    } catch (_) {
      // Pointer capture is optional; dragging still works without it.
    }
  });

  marker.addEventListener("pointermove", (event) => {
    if (!dragging) return;

    if (Math.abs(event.clientX - startX) > 3) {
      moved = true;
    }

    if (!moved) return;

    const laneRect = lane.getBoundingClientRect();

    // Calculate position relative to the start of the timeline lane.
    const rawBeat =
      (event.clientX - laneRect.left) / BEAT_WIDTH;

    latestBeat = snapBeat(rawBeat);
    hit.beat = latestBeat;

    marker.style.left = `${beatToPixels(hit.beat)}px`;
    marker.title =
      `${INSTRUMENTS.find((item) => item.id === trackId).name}` +
      ` · Beat ${hit.beat.toFixed(2)}. Drag to move.`;

    updatePlayheadDisplay();
  });

  function finishDrag() {
    if (!dragging) return;

    dragging = false;
    marker.classList.remove("dragging");

    if (moved && Math.abs(latestBeat - originalBeat) > 0.0001) {
      // Save the old arrangement so Undo can restore it.
      const currentSnapshot = snapshotHits();
      const currentData = JSON.parse(currentSnapshot);

      // Rebuild the previous arrangement with this hit's old position.
      const trackHits = currentData.tracks[trackId];
      const savedHit = trackHits.find((item) => item.id === hit.id);

      if (savedHit) savedHit.beat = originalBeat;

      state.undoStack.push(JSON.stringify(currentData));

      if (state.undoStack.length > state.maxHistory) {
        state.undoStack.shift();
      }

      state.redoStack = [];
      updateHistoryButtons();
      setStatus("Hit moved");
    }

    // Keep hits in timeline order.
    state.tracks[trackId].hits.sort((a, b) => a.beat - b.beat);

    renderTracks();
  }

  marker.addEventListener("pointerup", finishDrag);
  marker.addEventListener("pointercancel", finishDrag);
}

/* =========================================
   RECORD A DRUM HIT
   ========================================= */

function hitDrum(instrumentId) {
  initAudio();
  playDrum(instrumentId);

  // Briefly animate the matching pad.
  const pad = drumPads.querySelector(
    `[data-instrument="${instrumentId}"]`
  );

  if (pad) {
    pad.classList.add("pad-active");
    window.setTimeout(() => {
      pad.classList.remove("pad-active");
    }, 90);
  }

  // Recording adds hits only to the selected instrument's track.
  if (state.isRecording && state.selectedTrack === instrumentId) {
    const track = state.tracks[instrumentId];
    const hit = createHit(snapBeat(state.playheadBeat));

    track.hits.push(hit);
    track.hits.sort((a, b) => a.beat - b.beat);

    // Save a snapshot before this recording change.
    const snapshot = snapshotHits();
    const data = JSON.parse(snapshot);
    const savedHit = data.tracks[instrumentId].find(
      (item) => item.id === hit.id
    );

    if (savedHit) {
      data.tracks[instrumentId] = data.tracks[instrumentId].filter(
        (item) => item.id !== hit.id
      );

      state.undoStack.push(JSON.stringify(data));

      if (state.undoStack.length > state.maxHistory) {
        state.undoStack.shift();
      }

      state.redoStack = [];
      updateHistoryButtons();
    }

    renderTracks();
  }
}

/* =========================================
   PLAYBACK AND TRANSPORT
   ========================================= */

function setStatus(message, recording = false) {
  transportStatus.textContent = message;
  transportStatus.classList.toggle("recording-status", recording);
}

function updatePlayheadDisplay() {
  const beat = Math.max(0, state.playheadBeat);
  const barNumber = Math.floor(beat / BEATS_PER_BAR) + 1;
  const beatNumber =
    Math.floor(beat % BEATS_PER_BAR) + 1;

  positionDisplay.textContent =
    `Bar ${barNumber} · Beat ${beatNumber}`;

  playhead.style.left =
    `${LABEL_WIDTH + beatToPixels(beat)}px`;
}

function updateTransportUI() {
  recordButton.classList.toggle("recording", state.isRecording);
  playButton.textContent = state.isPlaying ? "Ⅱ Pause" : "▶ Play";

  if (state.isRecording) {
    setStatus("Recording — play the selected track", true);
  } else if (state.isPlaying) {
    setStatus("Playing your beat");
  } else {
    setStatus("Ready to make music");
  }
}

function triggerHitsBetween(startBeat, endBeat) {
  if (endBeat < startBeat) return;

  const anySolo = INSTRUMENTS.some(
    (instrument) => state.tracks[instrument.id].solo
  );

  INSTRUMENTS.forEach((instrument) => {
    const track = state.tracks[instrument.id];

    if (track.muted) return;
    if (anySolo && !track.solo) return;

    track.hits.forEach((hit) => {
      if (hit.beat > startBeat && hit.beat <= endBeat) {
        playDrum(instrument.id);
      }
    });
  });
}

function tick() {
  if (!state.isPlaying) return;

  const now = performance.now();
  const secondsPerBeat = 60 / state.tempo;

  if (!state.lastTickTime) {
    state.lastTickTime = now;
    return;
  }

  const elapsedSeconds = (now - state.lastTickTime) / 1000;
  state.lastTickTime = now;

  const advance = elapsedSeconds / secondsPerBeat;
  const oldBeat = state.playheadBeat;
  let newBeat = oldBeat + advance;
  const loopBeats = getLoopBeats();

  if (newBeat >= loopBeats) {
    triggerHitsBetween(oldBeat, loopBeats - 0.0001);

    newBeat = newBeat % loopBeats;
    state.previousBeat = 0;

    // Play hits at the beginning of each new loop.
    triggerHitsBetween(-0.0001, newBeat);
  } else {
    triggerHitsBetween(oldBeat, newBeat);
  }

  state.playheadBeat = newBeat;
  updatePlayheadDisplay();
}

function startTransport() {
  initAudio();
  if (!state.audio) return;

  if (state.audio.state === "suspended") {
    state.audio.resume();
  }

  if (state.isPlaying) return;

  state.isPlaying = true;
  state.lastTickTime = performance.now();

  state.timer = window.setInterval(tick, 10);
  updateTransportUI();
}

function pauseTransport() {
  state.isPlaying = false;

  if (state.timer !== null) {
    window.clearInterval(state.timer);
    state.timer = null;
  }

  state.lastTickTime = 0;
  updateTransportUI();
}

function stopTransport() {
  pauseTransport();

  state.isRecording = false;
  state.playheadBeat = 0;
  state.previousBeat = 0;

  updatePlayheadDisplay();
  updateTransportUI();
}

function toggleRecord() {
  initAudio();
  if (!state.audio) return;

  if (state.isRecording) {
    state.isRecording = false;
    updateTransportUI();
    return;
  }

  // Start a fresh recording pass from the beginning of the loop.
  state.playheadBeat = 0;
  state.previousBeat = 0;
  state.isRecording = true;

  if (!state.isPlaying) {
    startTransport();
  }

  updateTransportUI();
}

/* =========================================
   QUANTIZE SELECTED TRACK
   Move each hit to its nearest grid line.
   ========================================= */

function quantizeSelectedTrack() {
  const track = state.tracks[state.selectedTrack];

  if (!track || track.hits.length === 0) {
    setStatus("No hits on the selected track to quantize");
    return;
  }

  saveHistory();

  track.hits.forEach((hit) => {
    hit.beat = snapBeat(hit.beat);
  });

  track.hits.sort((a, b) => a.beat - b.beat);

  renderTracks();
  setStatus("Selected track quantized");
}

/* =========================================
   CLEAR THE SELECTED TRACK
   ========================================= */

function clearSelectedTrack() {
  const track = state.tracks[state.selectedTrack];

  if (!track || track.hits.length === 0) {
    setStatus("The selected track is already empty");
    return;
  }

  saveHistory();
  track.hits = [];
  state.selectedHit = null;

  renderTracks();
  setStatus("Selected track cleared");
}

/* =========================================
   EVENT LISTENERS
   ========================================= */

recordButton.addEventListener("click", toggleRecord);

playButton.addEventListener("click", () => {
  if (state.isPlaying) {
    pauseTransport();
  } else {
    startTransport();
  }
});

stopButton.addEventListener("click", stopTransport);

tempoInput.addEventListener("input", () => {
  state.tempo = Number(tempoInput.value);
  tempoValue.textContent = String(state.tempo);
});

loopLength.addEventListener("change", () => {
  state.bars = Number(loopLength.value);

  // Remove hits beyond the new loop length.
  Object.values(state.tracks).forEach((track) => {
    track.hits = track.hits.filter(
      (hit) => hit.beat < getLoopBeats()
    );
  });

  state.playheadBeat = Math.min(
    state.playheadBeat,
    getLoopBeats() - 0.001
  );

  renderTracks();
  setStatus(`Loop length set to ${state.bars} bars`);
});

masterVolume.addEventListener("input", () => {
  state.masterVolume = Number(masterVolume.value) / 100;
  masterValue.textContent = masterVolume.value;

  if (state.masterGain) {
    state.masterGain.gain.value = state.masterVolume;
  }
});

selectedTrackSelect.addEventListener("change", () => {
  selectTrack(selectedTrackSelect.value);
});

snapGrid.addEventListener("change", () => {
  state.snap = Number(snapGrid.value);
  setStatus(`Snap grid set to 1/${Math.round(1 / state.snap)} notes`);
});

quantizeButton.addEventListener("click", quantizeSelectedTrack);
undoButton.addEventListener("click", undo);
redoButton.addEventListener("click", redo);
clearButton.addEventListener("click", clearSelectedTrack);

// Keyboard shortcuts trigger the matching drum pad.
// Ignore shortcuts while typing into form fields.
document.addEventListener("keydown", (event) => {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) {
    return;
  }

  const target = event.target;
  const tag = target && target.tagName
    ? target.tagName.toLowerCase()
    : "";

  if (["input", "textarea", "select"].includes(tag)) return;
  if (target && target.isContentEditable) return;

  const key = event.key.toUpperCase();

  const instrument = INSTRUMENTS.find(
    (item) => item.key === key
  );

  if (instrument) {
    event.preventDefault();
    hitDrum(instrument.id);
  }
});

// Stop playback if the page is closed or refreshed.
window.addEventListener("beforeunload", () => {
  if (state.timer !== null) {
    window.clearInterval(state.timer);
  }

  if (state.audio) {
    state.audio.close();
  }
});

/* =========================================
   INITIALIZE THE APP
   ========================================= */

function initialize() {
  buildSelectedTrackOptions();
  buildPads();
  renderTracks();
  updateHistoryButtons();
  updateTransportUI();
  updatePlayheadDisplay();

  tempoValue.textContent = String(state.tempo);
  masterValue.textContent = String(
    Math.round(state.masterVolume * 100)
  );

  setStatus("Ready to make music");
}

initialize();
