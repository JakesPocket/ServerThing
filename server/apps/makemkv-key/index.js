module.exports = {
  metadata: {
    name: 'MakeMKV Key Status',
    description: 'Checks whether the MakeMKV beta key is valid'
  },

  init({ app }) {
    // Simple test endpoint
    app.get('/apps/makemkv-key/status', (req, res) => {
      res.json({
        status: 'unknown',
        message: 'App is running'
      });
    });
  }
};
