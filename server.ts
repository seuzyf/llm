import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API route to proxy chat requests to LM Studio
  app.post('/api/chat', async (req, res) => {
    try {
      const lmStudioUrl = process.env.LM_STUDIO_URL || 'http://127.0.0.1:1234/v1/chat/completions';
      
      const response = await fetch(lmStudioUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Pass authorization if needed, though LM Studio usually doesn't require it
          ...(req.headers.authorization ? { 'Authorization': req.headers.authorization } : {})
        },
        body: JSON.stringify(req.body)
      });

      if (!response.ok) {
        const errorText = await response.text();
        return res.status(response.status).json({ error: errorText });
      }

      // If streaming is requested, pipe the response
      if (req.body.stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        if (response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(decoder.decode(value));
          }
          res.end();
        } else {
          res.status(500).json({ error: 'Response body is empty' });
        }
      } else {
        const data = await response.json();
        res.json(data);
      }
    } catch (error: any) {
      console.error('Error proxying to LM Studio:', error);
      res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
  });

  // API route to proxy models request
  app.get('/api/models', async (req, res) => {
    try {
      const lmStudioBaseUrl = (process.env.LM_STUDIO_URL || 'http://127.0.0.1:1234/v1/chat/completions').replace('/chat/completions', '');
      const response = await fetch(`${lmStudioBaseUrl}/models`);
      
      if (!response.ok) {
        return res.status(response.status).json({ error: 'Failed to fetch models' });
      }
      
      const data = await response.json();
      res.json(data);
    } catch (error: any) {
      console.error('Error fetching models:', error);
      res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
