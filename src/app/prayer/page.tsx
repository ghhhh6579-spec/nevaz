'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

interface PrayerTime {
  name: string
  arabic: string
  time: string
  key: string
}

interface TimingsResponse {
  data: {
    timings: Record<string, string>
    date: {
      hijri: {
        date: string
        month: { en: string; ar: string }
        year: string
        day: string
      }
    }
  }
}

const PRAYER_KEYS = [
  { key: 'Fajr', name: 'Фаджр', arabic: 'الفجر' },
  { key: 'Sunrise', name: 'Восход', arabic: 'الشروق' },
  { key: 'Dhuhr', name: 'Зухр', arabic: 'الظهر' },
  { key: 'Asr', name: 'Аср', arabic: 'العصر' },
  { key: 'Maghrib', name: 'Магриб', arabic: 'المغرب' },
  { key: 'Isha', name: 'Иша', arabic: 'العشاء' },
]

function parseTime(raw: string): string {
  const match = raw.match(/^(\d{1,2}):(\d{2})/)
  if (!match) return '--:--'
  const h = String(match[1]).padStart(2, '0')
  const m = String(match[2]).padStart(2, '0')
  return `${h}:${m}`
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

function formatCountdown(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  return `${m}:${String(s).padStart(2, '0')}`
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

  const loadPrayers = useCallback(async (lat: number, lng: number) => {
    try {
      const today = new Date()
      const dateStr = `${String(today.getDate()).padStart(2, '0')}-${String(today.getMonth() + 1).padStart(2, '0')}-${today.getFullYear()}`

      const [timingsRes, geoRes] = await Promise.all([
        fetch(`https://api.aladhan.com/v1/timings/${dateStr}?latitude=${lat}&longitude=${lng}&method=14`),
        fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`),
      ])

      const timingsData: TimingsResponse = await timingsRes.json()
      const geoData = await geoRes.json()

      const timings = timingsData.data.timings
      const hijri = timingsData.data.date.hijri

      setHijriDate(`${hijri.day} ${hijri.month.en} ${hijri.year} г.х.`)
      setCity(
        geoData.address?.city ||
          geoData.address?.town ||
          geoData.address?.village ||
          geoData.address?.county ||
          'Ваш город'
      )

      const prayerList: PrayerTime[] = PRAYER_KEYS.map((p) => ({
        key: p.key,
        name: p.name,
        arabic: p.arabic,
        time: timings[p.key] ? parseTime(timings[p.key]) : '--:--',
      }))

      setPrayers(prayerList)
    } catch {
      setError('Не удалось загрузить время намазов')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!navigator.geolocation) {
      setError('Геолокация не поддерживается')
      setLoading(false)
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => loadPrayers(pos.coords.latitude, pos.coords.longitude),
      () => {
        loadPrayers(55.7558, 37.6176)
        setCity('Москва (по умолчанию)')
      }
    )
  }, [loadPrayers])

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!prayers.length) return

    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    const nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()

    let current = -1
    let next = -1

    for (let i = 0; i < prayers.length; i++) {
      const pMin = timeToMinutes(prayers[i].time)
      const nextPMin = i + 1 < prayers.length ? timeToMinutes(prayers[i + 1].time) : 24 * 60

      if (nowMinutes >= pMin && nowMinutes < nextPMin) {
        current = i
        next = i + 1 < prayers.length ? i + 1 : 0
        break
      }
    }

    if (current === -1) {
      next = 0
      current = prayers.length - 1
    }

    setCurrentIdx(current)
    setNextIdx(next)

    if (next >= 0) {
      const nextMin = timeToMinutes(prayers[next].time)
      let nextSec = nextMin * 60
      if (nextSec < nowSeconds) nextSec += 24 * 3600
      setCountdown(nextSec - nowSeconds)
    }
  }, [now, prayers])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.replace('/auth')
  }

  const gregorianDate = now.toLocaleDateString('ru-RU', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
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
              <div className="text-emerald-400 text-sm font-medium mb-1">{city}</div>
              <div className="text-white text-2xl font-bold">
                {now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
              <div className="text-gray-400 text-sm mt-1 capitalize">{gregorianDate}</div>
              {hijriDate && (
                <div className="text-emerald-500 text-xs mt-1">{hijriDate}</div>
              )}
            </div>

            {nextIdx >= 0 && prayers[nextIdx] && (
              <div className="bg-emerald-600/20 border border-emerald-500/30 rounded-2xl p-4 mb-6 text-center">
                <div className="text-emerald-400 text-xs font-medium mb-1">Следующий намаз</div>
                <div className="text-white font-bold text-lg">{prayers[nextIdx].name}</div>
                <div className="text-emerald-300 text-sm">{prayers[nextIdx].arabic}</div>
                <div className="text-white text-2xl font-mono font-bold mt-2">
                  {formatCountdown(countdown)}
                </div>
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
                      {isCurrent && (
                        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                      )}
                      {!isCurrent && <div className="w-2 h-2 rounded-full bg-transparent" />}
                      <div>
                        <div className={`font-semibold ${isCurrent ? 'text-white' : 'text-gray-200'}`}>
                          {prayer.name}
                        </div>
                        <div className="text-gray-500 text-xs" style={{ fontFamily: 'serif' }}>
                          {prayer.arabic}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div
                        className={`font-mono font-bold text-lg ${
                          isCurrent ? 'text-emerald-400' : isNext ? 'text-emerald-500' : 'text-gray-300'
                        }`}
                      >
                        {prayer.time}
                      </div>
                      {isCurrent && (
                        <div className="text-emerald-500 text-xs">сейчас</div>
                      )}
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
