'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import * as adhan from 'adhan'

interface PrayerTime {
  name: string
  arabic: string
  time: string
  key: string
  date: Date
}

interface CityResult {
  display_name: string
  lat: string
  lon: string
  address: { city?: string; town?: string; village?: string; county?: string; country?: string }
}

const PRAYER_DEFS = [
  { key: 'fajr',    name: 'Фаджр',  arabic: 'الفجر'  },
  { key: 'sunrise', name: 'Восход', arabic: 'الشروق' },
  { key: 'dhuhr',   name: 'Зухр',   arabic: 'الظهر'  },
  { key: 'asr',     name: 'Аср',    arabic: 'العصر'  },
  { key: 'maghrib', name: 'Магриб', arabic: 'المغرب' },
  { key: 'isha',    name: 'Иша',    arabic: 'العشاء' },
]

const SAVED_CITY_KEY = 'prayer_city'

function dateToHHMM(date: Date): string {
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function dateToMinutes(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
}

function formatCountdown(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
}

function calcPrayers(lat: number, lng: number, date: Date): PrayerTime[] {
  const coordinates = new adhan.Coordinates(lat, lng)
  const params = adhan.CalculationMethod.MuslimWorldLeague()
  if (lat > 48) {
    params.highLatitudeRule = adhan.HighLatitudeRule.SeventhOfTheNight
  }
  const pt = new adhan.PrayerTimes(coordinates, date, params)
  return PRAYER_DEFS.map((p) => {
    const d = pt[p.key as keyof adhan.PrayerTimes] as Date
    return { key: p.key, name: p.name, arabic: p.arabic, time: dateToHHMM(d), date: d }
  })
}

function cityLabel(r: CityResult): string {
  const a = r.address
  return [a.city || a.town || a.village || a.county, a.country].filter(Boolean).join(', ')
}

export default function PrayerPage() {
  const router = useRouter()
  const [userName, setUserName] = useState('')
  const [prayers, setPrayers] = useState<PrayerTime[]>([])
  const [hijriDate, setHijriDate] = useState('')
  const [city, setCity] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [now, setNow] = useState(new Date())
  const [currentIdx, setCurrentIdx] = useState(-1)
  const [nextIdx, setNextIdx] = useState(-1)
  const [countdown, setCountdown] = useState(0)

  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<CityResult[]>([])
  const [searching, setSearching] = useState(false)
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        router.replace('/auth')
        return
      }
      const meta = session.user.user_metadata
      setUserName(meta?.full_name || session.user.email || '')
    })
  }, [router])

  const loadPrayers = useCallback(async (lat: number, lng: number, cityName?: string) => {
    try {
      const today = new Date()
      setPrayers(calcPrayers(lat, lng, today))

      const [geoRes, hijriRes] = await Promise.all([
        cityName ? Promise.resolve(null) : fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`),
        fetch(`https://api.aladhan.com/v1/gToH/${String(today.getDate()).padStart(2,'0')}-${String(today.getMonth()+1).padStart(2,'0')}-${today.getFullYear()}`),
      ])

      if (cityName) {
        setCity(cityName)
      } else if (geoRes) {
        const geoData = await geoRes.json()
        setCity(geoData.address?.city || geoData.address?.town || geoData.address?.village || geoData.address?.county || 'Ваш город')
      }

      const hijriData = await hijriRes.json()
      const h = hijriData?.data?.hijri
      if (h) setHijriDate(`${h.day} ${h.month.en} ${h.year} г.х.`)
    } catch {
      setError('Не удалось загрузить данные')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const saved = localStorage.getItem(SAVED_CITY_KEY)
    if (saved) {
      try {
        const { lat, lng, name } = JSON.parse(saved)
        loadPrayers(lat, lng, name)
        return
      } catch {
        localStorage.removeItem(SAVED_CITY_KEY)
      }
    }
    if (!navigator.geolocation) {
      setError('Геолокация не поддерживается')
      setLoading(false)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => loadPrayers(pos.coords.latitude, pos.coords.longitude),
      () => {
        loadPrayers(55.7558, 37.6176, 'Москва (по умолчанию)')
      }
    )
  }, [loadPrayers])

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!prayers.length) return
    const nowMin = now.getHours() * 60 + now.getMinutes()
    const nowSec = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()
    let current = -1, next = -1
    for (let i = 0; i < prayers.length; i++) {
      const pMin = dateToMinutes(prayers[i].date)
      const nextPMin = i + 1 < prayers.length ? dateToMinutes(prayers[i + 1].date) : 24 * 60
      if (nowMin >= pMin && nowMin < nextPMin) {
        current = i
        next = i + 1 < prayers.length ? i + 1 : 0
        break
      }
    }
    if (current === -1) { next = 0; current = prayers.length - 1 }
    setCurrentIdx(current)
    setNextIdx(next)
    if (next >= 0) {
      const nextSec = prayers[next].date.getHours() * 3600 + prayers[next].date.getMinutes() * 60
      setCountdown(nextSec < nowSec ? nextSec + 24 * 3600 - nowSec : nextSec - nowSec)
    }
  }, [now, prayers])

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return }
    if (searchTimeout.current) clearTimeout(searchTimeout.current)
    searchTimeout.current = setTimeout(async () => {
      setSearching(true)
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=json&addressdetails=1&limit=5&featuretype=city`
        )
        const data: CityResult[] = await res.json()
        setSearchResults(data)
      } catch {
        setSearchResults([])
      } finally {
        setSearching(false)
      }
    }, 400)
  }, [searchQuery])

  const selectCity = (result: CityResult) => {
    const lat = parseFloat(result.lat)
    const lng = parseFloat(result.lon)
    const name = cityLabel(result)
    localStorage.setItem(SAVED_CITY_KEY, JSON.stringify({ lat, lng, name }))
    setShowSearch(false)
    setSearchQuery('')
    setSearchResults([])
    setLoading(true)
    loadPrayers(lat, lng, name)
  }

  const resetToGeo = () => {
    localStorage.removeItem(SAVED_CITY_KEY)
    setShowSearch(false)
    setSearchQuery('')
    setSearchResults([])
    setLoading(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => loadPrayers(pos.coords.latitude, pos.coords.longitude),
      () => loadPrayers(55.7558, 37.6176, 'Москва (по умолчанию)')
    )
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.replace('/auth')
  }

  const gregorianDate = now.toLocaleDateString('ru-RU', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  })

  return (
    <div className="min-h-screen">
      <header className="flex items-center justify-between px-6 py-4 border-b border-emerald-900/30">
        <div className="flex items-center gap-3">
          <span className="text-2xl">☪️</span>
          <div>
            <div className="text-white font-semibold text-sm">Исламский портал</div>
            {userName && <div className="text-emerald-400 text-xs">{userName}</div>}
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="text-gray-400 hover:text-white text-sm transition-colors px-3 py-1.5 rounded-lg hover:bg-gray-800/50"
        >
          Выйти
        </button>
      </header>

      <main className="max-w-lg mx-auto px-4 py-8">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-20 gap-4">
            <div className="w-10 h-10 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-400 text-sm">Определяем местоположение...</p>
          </div>
        ) : error ? (
          <div className="text-center py-20 text-red-400">{error}</div>
        ) : (
          <>
            <div className="text-center mb-8">
              <button
                onClick={() => setShowSearch(true)}
                className="inline-flex items-center gap-1.5 text-emerald-400 text-sm font-medium hover:text-emerald-300 transition-colors mb-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                {city}
                <svg className="w-3 h-3 opacity-60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
              <div className="text-white text-2xl font-bold">
                {now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
              <div className="text-gray-400 text-sm mt-1 capitalize">{gregorianDate}</div>
              {hijriDate && <div className="text-emerald-500 text-xs mt-1">{hijriDate}</div>}
            </div>

            {showSearch && (
              <div className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center pt-20 px-4">
                <div className="bg-gray-900 border border-emerald-900/40 rounded-2xl w-full max-w-md shadow-2xl">
                  <div className="p-4 border-b border-gray-800">
                    <div className="flex items-center gap-2 mb-3">
                      <h2 className="text-white font-semibold flex-1">Выбор города</h2>
                      <button onClick={() => { setShowSearch(false); setSearchQuery(''); setSearchResults([]) }} className="text-gray-400 hover:text-white">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    <input
                      autoFocus
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Введите название города..."
                      className="w-full bg-gray-800 text-white rounded-xl px-4 py-2.5 text-sm outline-none border border-gray-700 focus:border-emerald-500 placeholder-gray-500"
                    />
                  </div>
                  <div className="max-h-64 overflow-y-auto">
                    {searching && (
                      <div className="text-gray-400 text-sm text-center py-6">Поиск...</div>
                    )}
                    {!searching && searchResults.length === 0 && searchQuery.trim() && (
                      <div className="text-gray-500 text-sm text-center py-6">Ничего не найдено</div>
                    )}
                    {!searching && searchResults.map((r, i) => (
                      <button
                        key={i}
                        onClick={() => selectCity(r)}
                        className="w-full text-left px-4 py-3 hover:bg-gray-800 transition-colors border-b border-gray-800/50 last:border-0"
                      >
                        <div className="text-white text-sm font-medium">{cityLabel(r)}</div>
                        <div className="text-gray-500 text-xs mt-0.5 truncate">{r.display_name}</div>
                      </button>
                    ))}
                  </div>
                  <div className="p-3 border-t border-gray-800">
                    <button
                      onClick={resetToGeo}
                      className="w-full text-emerald-400 text-sm py-2 hover:text-emerald-300 transition-colors flex items-center justify-center gap-1.5"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      Определить автоматически
                    </button>
                  </div>
                </div>
              </div>
            )}

            {nextIdx >= 0 && prayers[nextIdx] && (
              <div className="bg-emerald-600/20 border border-emerald-500/30 rounded-2xl p-4 mb-6 text-center">
                <div className="text-emerald-400 text-xs font-medium mb-1">Следующий намаз</div>
                <div className="text-white font-bold text-lg">{prayers[nextIdx].name}</div>
                <div className="text-emerald-300 text-sm">{prayers[nextIdx].arabic}</div>
                <div className="text-white text-2xl font-mono font-bold mt-2">{formatCountdown(countdown)}</div>
                <div className="text-gray-400 text-xs mt-1">до {prayers[nextIdx].time}</div>
              </div>
            )}

            <div className="space-y-3">
              {prayers.map((prayer, idx) => {
                const isCurrent = idx === currentIdx
                const isNext = idx === nextIdx
                return (
                  <div
                    key={prayer.key}
                    className={`flex items-center justify-between px-5 py-4 rounded-2xl border transition-all ${
                      isCurrent
                        ? 'bg-emerald-600/25 border-emerald-500/50 shadow-lg shadow-emerald-900/30'
                        : isNext
                        ? 'bg-emerald-900/20 border-emerald-700/30'
                        : 'bg-gray-900/40 border-gray-800/40'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div className={`w-2 h-2 rounded-full ${isCurrent ? 'bg-emerald-400 animate-pulse' : 'bg-transparent'}`} />
                      <div>
                        <div className={`font-semibold ${isCurrent ? 'text-white' : 'text-gray-200'}`}>{prayer.name}</div>
                        <div className="text-gray-500 text-xs" style={{ fontFamily: 'serif' }}>{prayer.arabic}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-mono font-bold text-lg ${isCurrent ? 'text-emerald-400' : isNext ? 'text-emerald-500' : 'text-gray-300'}`}>
                        {prayer.time}
                      </div>
                      {isCurrent && <div className="text-emerald-500 text-xs">сейчас</div>}
                    </div>
                  </div>
                )
              })}
            </div>
          </>
        )}
      </main>
    </div>
  )
}
