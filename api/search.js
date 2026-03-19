const cache = new Map()
const CACHE_TTL = 12 * 60 * 60 * 1000
const rateLimit = new Map()
const MAX_REQUESTS = 25
const WINDOW_MS = 4 * 60 * 60 * 1000

// Venues conocidos por ciudad — se puede ampliar
const VENUES_BY_CITY = {
  'buenos aires': 'Movistar Arena, Estadio River Plate, La Bombonera, Estadio Vélez, Luna Park, Estadio Obras Sanitarias, Teatro Colón, Gran Rex, ND Ateneo, Niceto Club, La Trastienda, Estadio San Lorenzo, Estadio Racing, Estadio Independiente, Parque Roca, La Rural, CCK, Usina del Arte',
  'rio de janeiro': 'Maracanã, Estádio Nilton Santos, Vivo Rio, Circo Voador, Qualistage, Jeunesse Arena, Copacabana Palace, Pier Mauá',
  'sao paulo': 'Allianz Parque, Neo Química Arena, Morumbi, Vibra São Paulo, Audio Club, Complexo Apotheke, Carioca Club',
  'mendoza': 'Estadio Malvinas Argentinas, Teatro Independencia, Arena Maipú, Estadio Aconcagua Arena',
  'cordoba': 'Estadio Mario Alberto Kempes, Quality Espacio, Orfeo Superdomo, Teatro del Libertador',
  'montevideo': 'Estadio Centenario, Teatro Solís, Antel Arena, Sala del Museo',
  'santiago de chile': 'Estadio Nacional, Movistar Arena Santiago, Teatro Caupolicán, Club Chocolate',
  'lima': 'Estadio Nacional, Arena 1, Explanada Sur, Teatro Municipal',
  'bogota': 'Estadio El Campín, Movistar Arena Bogotá, Plaza Mayor',
  'ciudad de mexico': 'Foro Sol, Estadio Azteca, Palacio de los Deportes, Auditorio Nacional, Arena Ciudad de México',
  'madrid': 'Estadio Santiago Bernabéu, Metropolitano, WiZink Center, Palacio de los Deportes',
  'barcelona': 'Camp Nou, Palau Sant Jordi, Razzmatazz, Apolo',
  'buenos aires argentina': 'Movistar Arena, Estadio River Plate, La Bombonera, Estadio Vélez, Luna Park, Estadio Obras Sanitarias, Teatro Colón, Gran Rex, ND Ateneo, Niceto Club, La Trastienda',
}

function getVenuesForCity(destination) {
  const key = destination.toLowerCase().trim()
  for (const [city, venues] of Object.entries(VENUES_BY_CITY)) {
    if (key.includes(city) || city.includes(key)) return venues
  }
  return null
}

function checkRateLimit(ip) {
  const now = Date.now()
  const record = rateLimit.get(ip)
  if (!record) { rateLimit.set(ip, { count: 1, start: now }); return true }
  if (now - record.start > WINDOW_MS) { rateLimit.set(ip, { count: 1, start: now }); return true }
  if (record.count >= MAX_REQUESTS) return false
  record.count++
  return true
}

function getCacheKey(d, dias, f, i) { return `${d.toLowerCase().trim()}|${dias}|${f}|${i}` }

function getFromCache(key) {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_TTL) { cache.delete(key); return null }
  return entry.data
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() })
  if (cache.size > 200) {
    const now = Date.now()
    for (const [k, v] of cache.entries()) {
      if (now - v.timestamp > CACHE_TTL) cache.delete(k)
    }
  }
}

function safeParseJSON(text) {
  let clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  try { return JSON.parse(clean) } catch(e) {}
  const start = clean.indexOf('{')
  const end = clean.lastIndexOf('}')
  if (start === -1 || end === -1) return null
  clean = clean.substring(start, end + 1)
  try { return JSON.parse(clean) } catch(e) {}
  try {
    const destMatch = clean.match(/"destination"\s*:\s*"([^"]+)"/)
    const insightMatch = clean.match(/"rm_insight"\s*:\s*"((?:[^"\\]|\\.)*)"/s)
    const evStart = clean.indexOf('"events"')
    const arrStart = clean.indexOf('[', evStart)
    if (arrStart === -1) return null
    const events = []
    let pos = arrStart + 1, depth = 0, objStart = -1
    while (pos < clean.length) {
      const ch = clean[pos]
      if (ch === '{') { depth++; if (depth === 1) objStart = pos }
      else if (ch === '}') {
        depth--
        if (depth === 0 && objStart !== -1) {
          try { events.push(JSON.parse(clean.substring(objStart, pos + 1))) } catch(e) {}
          objStart = -1
        }
      } else if (ch === ']' && depth === 0) break
      pos++
    }
    return { destination: destMatch ? destMatch[1] : '', events, rm_insight: insightMatch ? insightMatch[1] : '' }
  } catch(e) { return null }
}

async function geminiSearch(prompt, GEMINI_KEY) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4096 }
      })
    }
  )
  const data = await res.json()
  if (data.error) throw new Error(data.error.message)
  const parts = data.candidates?.[0]?.content?.parts || []
  return parts.filter(p => p.text).map(p => p.text).join('')
}

function parseArray(text) {
  const clean = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
  const start = clean.indexOf('[')
  const end = clean.lastIndexOf(']')
  if (start === -1 || end === -1) return []
  try { return JSON.parse(clean.substring(start, end + 1)) } catch(e) { return [] }
}

function deduplicateEvents(events) {
  const seen = new Set()
  return events.filter(ev => {
    const key = `${ev.name?.toLowerCase().trim().substring(0,25)}|${ev.day}|${ev.month}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })
  const { destination, dias, foco, idioma } = req.body
  if (!destination) return res.status(400).json({ error: 'Missing destination' })

  const ip = req.headers['x-forwarded-for']?.split(',')[0] || 'unknown'
  if (!checkRateLimit(ip)) {
    const record = rateLimit.get(ip)
    const resetIn = Math.ceil((record.start + WINDOW_MS - Date.now()) / 60000)
    return res.status(429).json({ error: `Límite alcanzado (${MAX_REQUESTS} búsquedas cada 4 horas). Intentá en ${resetIn} minutos.` })
  }

  const GEMINI_KEY = process.env.GEMINI_API_KEY_RADAR
  if (!GEMINI_KEY) return res.status(500).json({ error: 'Missing Gemini API key' })

  const cacheKey = getCacheKey(destination, dias, foco, idioma)
  const cached = getFromCache(cacheKey)
  if (cached) return res.status(200).json({ ...cached, _cached: true })

  const hoy = new Date().toISOString().split('T')[0]
  const lang = idioma || 'español'
  const focoMap = { general: 'impacto general en demanda hotelera', leisure: 'segmento leisure y turismo vacacional', mice: 'segmento corporativo, congresos y ferias MICE', grupos: 'grupos, agencias y turismo emisivo' }
  const venues = getVenuesForCity(destination)

  const jsonArr = `[{"name":"nombre","day":"DD","month":"MMM mayúsculas en ${lang}","year":"YYYY","category":"music|sport|cultural|mice|gastro|festivo|other","venue":"lugar","capacity":"aforo","impact":"impacto hotelero","importance":"high|medium"}]`

  try {
    // Definir búsquedas según si la ciudad tiene venues conocidos
    const searches = [
      // Búsqueda 1: Música y shows
      geminiSearch(`Buscá en Google la agenda completa de recitales, conciertos y shows en ${destination} para ${dias}. ${venues ? `Revisá específicamente la agenda de: ${venues}.` : ''} Incluí artistas nacionales e internacionales, grandes y pequeños. Solo desde ${hoy}. Respondé SOLO con JSON array sin markdown: ${jsonArr} En ${lang}.`, GEMINI_KEY),

      // Búsqueda 2: Deportes
      geminiSearch(`Buscá en Google todos los eventos deportivos en ${destination} para ${dias}: fútbol, básquet, tenis, rugby, maratones, torneos. ${venues ? `Venues: ${venues}.` : ''} Solo desde ${hoy}. Respondé SOLO con JSON array sin markdown: ${jsonArr} En ${lang}.`, GEMINI_KEY),

      // Búsqueda 3: Cultura, ferias, feriados + RM insight
      geminiSearch(`Buscá en Google ferias, exposiciones, congresos, feriados nacionales, festividades y eventos culturales en ${destination} para ${dias}. Solo desde ${hoy}.

Respondé con este JSON sin markdown:
{"events":${jsonArr},"rm_insight":"3 oraciones sobre ${focoMap[foco]||'impacto hotelero'}: pick-up esperado, fechas para subir tarifas y minimum stay. Sin comillas dobles internas."}
En ${lang}.`, GEMINI_KEY),

      // Búsqueda 4: Agenda específica de venues (solo si tiene venues conocidos, sino agenda general)
      venues
        ? geminiSearch(`Buscá en Google la agenda detallada de eventos para ${dias} en estos venues de ${destination}: ${venues}. Encontrá TODOS los eventos confirmados incluso los menos conocidos. Solo desde ${hoy}. Respondé SOLO con JSON array sin markdown: ${jsonArr} En ${lang}.`, GEMINI_KEY)
        : geminiSearch(`Buscá en Google "agenda eventos ${destination} ${dias}" y "qué hacer en ${destination}". Encontrá eventos locales, festivales regionales y actividades. Solo desde ${hoy}. Respondé SOLO con JSON array sin markdown: ${jsonArr} En ${lang}.`, GEMINI_KEY)
    ]

    const [musicText, sportText, cultureText, venueText] = await Promise.all(searches)

    const cultureData = safeParseJSON(cultureText)
    const cultureEvents = cultureData?.events || parseArray(cultureText)
    const rm_insight = cultureData?.rm_insight || ''

    const allEvents = deduplicateEvents([
      ...parseArray(musicText),
      ...parseArray(sportText),
      ...cultureEvents,
      ...parseArray(venueText)
    ])

    const result = { destination, events: allEvents, rm_insight }
    if (allEvents.length > 0) setCache(cacheKey, result)

    return res.status(200).json(result)

  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
