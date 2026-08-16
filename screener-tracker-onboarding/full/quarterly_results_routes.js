export function registerQuarterlyResultsRoutes(app, { auth, service } = {}) {
  if (!auth) throw new Error('auth middleware is required');
  if (!service) throw new Error('quarterly results service is required');

  app.get('/api/quarterly-results', auth, async (req, res) => {
    res.set?.('Cache-Control', 'no-store');
    try {
      res.json(await service.list(req.query, { userId: req.user.id }));
    } catch (error) {
      if (error.statusCode === 400) {
        res.status(400).json({ error: error.message });
      } else {
        res.status(500).json({ error: 'Unable to load quarterly results' });
      }
    }
  });
}
