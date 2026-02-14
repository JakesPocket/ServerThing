const fs = require('fs');
const path = require('path');
const https = require('https');
const querystring = require('querystring');

/**
 * Spotify App for ServerThing
 * Handles OAuth and Player control.
 */
class SpotifyApp {
  constructor() {
    this.metadata = {
      name: "Spotify Player",
      description: "Spotify music control.",
      version: "1.0.0"
    };

    // OAuth configuration (User will need to set these in a config file later)
    this.configPath = path.join(__dirname, 'config.json');
    this.state = this.loadConfig() || {
      accessToken: null,
      refreshToken: null,
      expiresAt: 0
    };
  }

  loadConfig() {
    if (fs.existsSync(this.configPath)) {
      return JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
    }
    return null;
  }

  saveConfig() {
    fs.writeFileSync(this.configPath, JSON.stringify(this.state, null, 2));
  }

  /**
   * Main entry point called by ServerThing AppManager
   */
  async init(appContext) {
    this.appContext = appContext;
    console.log('Spotify App Initialized');
    
    // Listen for commands from the device/simulator
    appContext.onInput((input) => {
      this.handleInput(input);
    });

    // Simulate real-time track updates every 10 seconds to show the port works
    setInterval(() => {
      this.sendTrackUpdate();
    }, 10000);
  }

  sendTrackUpdate() {
    const tracks = [
      { name: "Starboy", artist: "The Weeknd", art: "https://i.scdn.co/image/ab67616d0000b2734718e2d1d5391a98dc44f4d" },
      { name: "Blinding Lights", artist: "The Weeknd", art: "https://i.scdn.co/image/ab67616d0000b273c5649addda9ef3765e903f17" },
      { name: "Sicko Mode", artist: "Travis Scott", art: "https://i.scdn.co/image/ab67616d0000b273070383584481e4862f85457" }
    ];
    const track = tracks[Math.floor(Math.random() * tracks.length)];
    
    this.appContext.sendToDevice(null, {
      type: 'track-update',
      ...track,
      isPlaying: true
    });
  }

  async handleInput(input) {
    if (input.type === 'button') {
      switch(input.value) {
        case 'preset1': this.playPause(); break;
        case 'preset2': this.next(); break;
        case 'preset3': this.previous(); break;
      }
    }
    if (input.type === 'dial') {
      if (input.value === 'right') this.volumeUp();
      if (input.value === 'left') this.volumeDown();
    }
  }

  // --- Spotify API Methods ---

  async playPause() {
    console.log('Spotify: Play/Pause toggled');
    // Implement https call to api.spotify.com/v1/me/player/play or pause
  }

  async next() {
    console.log('Spotify: Skip Next');
  }

  async previous() {
    console.log('Spotify: Skip Previous');
  }

  async volumeUp() {
    console.log('Spotify: Volume Up');
  }

  async volumeDown() {
    console.log('Spotify: Volume Down');
  }
}

module.exports = new SpotifyApp();
