import { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(req: VercelRequest, res: VercelResponse) {
  console.log('Health check called');
  res.status(200).json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    path: '/api/health'
  });
}
