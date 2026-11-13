// Safe pure-JS shim for expo-av to prevent native crashes and build errors
const Audio = {
  setAudioModeAsync: async () => {},
  Sound: {
    createAsync: async () => ({
      sound: {
        playAsync: async () => {},
        stopAsync: async () => {},
        unloadAsync: async () => {},
        setOnPlaybackStatusUpdate: () => {},
      },
      status: { isLoaded: true },
    }),
  },
};

module.exports = {
  Audio,
  default: { Audio },
};
