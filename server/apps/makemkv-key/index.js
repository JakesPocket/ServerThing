const { exec } = require('child_process');
const express = require('express');

module.exports = {
  metadata: {
    name: 'MakeMKV Key Status',
    description: 'Checks whether the MakeMKV beta key is valid'
  },

  init({ app }) {
    app.get('/api/makemkv-key/localkey', (req, res) => {
      const command = `sshpass -p 'pockeT111' ssh -o StrictHostKeyChecking=no me@10.0.0.10 "cat /home/me/docker/acquisition/arm/.MakeMKV/settings.conf"`;

      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`exec error: ${error.message}`);
          return res.status(500).json({ error: 'Failed to fetch local key', details: stderr });
        }
        
        // Now, parse the stdout to find the key
        const match = stdout.match(/app_Key = "(.*?)"/);
        const currentKey = match ? match[1] : null;

        if (!currentKey) {
          return res.status(404).json({ error: 'Could not find app_Key in settings.conf' });
        }

        res.json({
          id: 'local',
          name: 'Local Config (ARM)',
          value: currentKey,
          // Expiry logic will be added later
          status: 'unknown', 
          expiry: 'Unknown'
        });
      });
    });
    console.log('[MakeMKV App] Route /api/makemkv-key/localkey registered.');

    app.post('/api/makemkv-key/update', express.json(), (req, res) => {
      const { newKey } = req.body;
      if (!newKey) {
        return res.status(400).json({ error: 'Missing newKey in request body' });
      }

      // Use sed to replace the key in the file. Note the careful quoting.
      const command = `sshpass -p 'pockeT111' ssh -o StrictHostKeyChecking=no me@10.0.0.10 "sed -i 's|app_Key = \".*\"|app_Key = \"${newKey}\"|' /home/me/docker/acquisition/arm/.MakeMKV/settings.conf"`;

      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`exec error during update: ${error.message}`);
          return res.status(500).json({ error: 'Failed to update local key', details: stderr });
        }
        res.json({ success: true, message: 'Local key updated successfully.' });
      });
    });
    console.log('[MakeMKV App] Route /api/makemkv-key/update registered.');

    // Simple test endpoint
    app.get('/apps/makemkv-key/status', (req, res) => {
      res.json({
        status: 'unknown',
        message: 'App is running'
      });
    });
  }
};
