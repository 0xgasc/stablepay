export default function handler(req, res) {
  res.status(200).json({ 
    status: 'healthy',
    time: new Date().toISOString(),
    method: req.method
  });
}