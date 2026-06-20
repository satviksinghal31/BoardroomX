export function registerDhanRoutes(app, {
  auth,
  marketData,
  getVisiblePriceSymbols = () => [],
} = {}) {
  if (!auth) throw new Error('auth middleware is required');
  if (!marketData) throw new Error('marketData is required');

  app.get('/api/chart/:symbol', auth, async (req, res) => {
    try {
      res.json(await marketData.getChart(req.params.symbol));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/prices', auth, async (req, res) => {
    try {
      const symbols = getVisiblePriceSymbols(req);
      res.json(await marketData.getPrices(symbols));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/quote/:symbol', auth, async (req, res) => {
    try {
      res.json(await marketData.getQuote(req.params.symbol));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/dhan/health', auth, async (_req, res) => {
    try {
      res.json(await marketData.getLiveHealth());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}
