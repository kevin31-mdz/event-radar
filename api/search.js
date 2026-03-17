import Anthropic from '@anthropic-ai/sdk'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { prompt } = req.body

  try {
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    })

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }]
    })

    // Devolver la respuesta completa para debug
    return res.status(200).json({
      contentBlocks: response.content.length,
      types: response.content.map(b => b.type),
      rawText: response.content.find(b => b.type === 'text')?.text || 'SIN TEXTO',
      stopReason: response.stop_reason
    })

  } catch (err) {
    return res.status(500).json({ error: err.message, details: err.error })
  }
}