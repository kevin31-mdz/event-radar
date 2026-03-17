import Anthropic from '@anthropic-ai/sdk'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY

  if (!apiKey) {
    return res.status(500).json({ error: 'API key not found in environment' })
  }

  return res.status(200).json({ 
    keyFound: true, 
    keyStart: apiKey.substring(0, 10) + '...' 
  })
}