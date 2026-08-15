export function registerQuarterlyResultsRoutes(app, { auth, service } = {}) {
  if (!auth) throw new Error('auth middleware is required');
  if (!service) throw new Error('quarterly results service is required');

  app.get('/api/quarterly-results', auth, async (req, res) => {
    res.set?.('Cache-Control', 'no-store');
    try {
      res.json(await service.list(req.query));
    } catch (error) {
      res.status(error.statusCode === 400 ? 400 : 500).json({ error: error.message });
    }
  });
}

