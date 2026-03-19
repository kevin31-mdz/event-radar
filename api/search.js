export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { destination, dias, foco, idioma } = req.body
  if (!destination) return res.status(400).json({ error: 'Missing destination' })
  const GOOGLE_API_KEY = process.env.GOOGLE_SEARCH_API_KEY
  const GOOGLE_CX = process.env.GOOGLE_SEARCH_CX
  const GEMINI_KEY = process.env.GEMINI_API_KEY_RADAR
  if (!GOOGLE_API_KEY || !GOOGLE_CX || !GEMINI_KEY) {
    return res.status(500).json({ error: 'Missing env vars', hasGoogleKey: !!GOOGLE_API_KEY, hasCX: !!GOOGLE_CX, hasGemini: !!GEMINI_KEY })
  }
  const focoMap = { general: 'impacto general en demanda hotelera', leisure: 'segmento leisure y turismo vacacional', mice: 'segmento corporativo, congresos y ferias MICE', grupos: 'grupos, agencias y turismo emisivo' }
  try {
    const query = `eventos ${destination} ${dias} conciertos festivales feriados deportes`
    const googleUrl = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(query)}&num=10`
    const googleRes = await fetch(googleUrl)
    const googleData = await googleRes.json()
    if (googleData.error) return res.status(500).json({ error: 'Google: ' + googleData.error.message })
    const snippets = (googleData.items || []).map(item => `${item.title}: ${item.snippet}`).join('\n')
    if (!snippets) return res.status(200).json({ destination, events: [], rm_insight: 'No se encontraron resultados.' })
    const hoy = new Date().toISOString().split('T')[0]
    const prompt = `Sos un asistente de revenue management hotelero. Analizá estos resultados de búsqueda sobre eventos en ${destination} para el período ${dias}:\n\n${snippets}\n\nExtraé TODOS los eventos con fecha ${hoy} o posterior.\n\nRespondé ÚNICAMENTE con este JSON válido sin texto extra:\n{"destination":"${destination}","events":[{"name":"nombre","day":"DD","month":"MMM mayúsculas en ${idioma||'español'}","year":"YYYY","category":"music|sport|cultural|mice|gastro|festivo|other","venue":"lugar","capacity":"aforo","impact":"impacto hotelero","importance":"high|medium"}],"rm_insight":"análisis de ${focoMap[foco]||'impacto hotelero'} en 3 oraciones"}\n\nRespondé en ${idioma||'español'}.`
    const geminiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 2048 } }) })
    const geminiData = await geminiRes.json()
    if (geminiData.error) return res.status(500).json({ error: 'Gemini: ' + geminiData.error.message })
    const text = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || ''
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) return res.status(200).json({ destination, events: [], rm_insight: text || 'No se pudieron estructurar los eventos.' })
    return res.status(200).json(JSON.parse(match[0]))
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
