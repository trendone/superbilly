// Pipeline-Forecast (v2.2): offene Zoho-Deals als weiche, wahrscheinlichkeits-
// gewichtete Ressourcen-Last. Bewusst getrennt von projects/bookings – die
// Planung (Billy) und Auswertung sehen davon nichts. Der Kapazitäts-Check baut
// auf der bestehenden Monats-Auslastungslogik der Auswertung auf.
//
// Fachliche Regeln (mit Nutzer geklärt):
//  - erwartete Tage   = Volumen(netto) / STANDARD_DAY_RATE (2000 €)
//  - gewichtete Tage  = erwartete Tage × Probability/100 (Zoho-Feld je Deal)
//  - Zeitraum         = ab Abschlussdatum vorwärts, max. 5 Tage/Woche

import { supabase } from './supabase'
import type { Database } from './database.types'
import { holidayName } from './holidays'
import { toISODate } from './dates'
import {
  STANDARD_DAY_RATE,
  employeeMonthStats,
  monthWindow,
  type AnalyticsData,
  type MonthWindow,
} from './analytics'

export type PipelineDeal = Database['public']['Tables']['pipeline_deals']['Row']

export interface PipelineSyncResult {
  ok: boolean
  deals_synced: number
  error?: string
}

/** Liest alle Pipeline-Deals (read-only Spiegelung offener Zoho-Deals). */
export async function fetchPipelineDeals(): Promise<PipelineDeal[]> {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')
  const { data, error } = await supabase
    .from('pipeline_deals')
    .select('*')
    .order('closing_date', { nullsFirst: false })
  if (error) throw error
  return data
}

/** Löst den manuellen Pipeline-Abruf aus (sync-pipeline Edge Function). */
export async function triggerPipelineSync(): Promise<PipelineSyncResult> {
  if (!supabase) throw new Error('Supabase nicht konfiguriert')
  const { data, error } = await supabase.functions.invoke('sync-pipeline', { method: 'POST' })
  if (error) throw error
  const result = data as PipelineSyncResult
  if (!result.ok) throw new Error(result.error ?? 'Pipeline-Abruf fehlgeschlagen')
  return result
}

// ── Rechenkern (reine Funktionen, testbar) ──────────────────────────

const monthKey = (year: number, month: number) => `${year}-${month}` // month 0-basiert

export interface DealForecast {
  deal: PipelineDeal
  expectedDays: number // Volumen / Tagessatz
  weightedDays: number // × Probability
  start: Date | null // Abschlussdatum
  end: Date | null // Ende der Verteilung
  weeks: number // Dauer in Wochen (max. 5 Tage/Woche)
  /** Gewichtete Last je Kalendermonat (Schlüssel "YYYY-M", month 0-basiert). */
  monthlyLoad: Map<string, number>
}

/**
 * Leitet aus einem Deal die erwartete/gewichtete Last und deren Verteilung ab:
 * ab Abschlussdatum werden die erwarteten Tage vorwärts verteilt, höchstens 5
 * pro Woche (ein Arbeitstag = eine Person-Tag-Einheit), Feiertage übersprungen.
 * Die gewichtete Last (× Probability) wird proportional auf die berührten
 * Kalendermonate gebucht.
 */
export function forecastFor(deal: PipelineDeal): DealForecast {
  const amount = deal.amount_eur != null ? Number(deal.amount_eur) : 0
  const prob = deal.probability != null ? Number(deal.probability) : 0
  const expectedDays = STANDARD_DAY_RATE > 0 ? amount / STANDARD_DAY_RATE : 0
  const weightedDays = expectedDays * (prob / 100)
  const weightPerDay = expectedDays > 0 ? weightedDays / expectedDays : 0 // = prob/100

  const monthlyLoad = new Map<string, number>()
  if (!deal.closing_date || expectedDays <= 0) {
    return { deal, expectedDays, weightedDays, start: null, end: null, weeks: 0, monthlyLoad }
  }

  const start = new Date(`${deal.closing_date}T00:00:00`)
  let remaining = expectedDays
  let lastDay = new Date(start)
  const cur = new Date(start)
  // Arbeitstage (Mo–Fr, keine Feiertage) ab Abschlussdatum belegen, je 1 Tag,
  // bis die erwarteten Tage aufgebraucht sind → automatisch max. 5/Woche.
  let guard = 0
  while (remaining > 1e-9 && guard < 2000) {
    guard++
    const dow = cur.getDay()
    const iso = toISODate(cur)
    if (dow >= 1 && dow <= 5 && !holidayName(iso)) {
      const place = Math.min(1, remaining) // letzter Tag ggf. Teil-Tag
      const k = monthKey(cur.getFullYear(), cur.getMonth())
      monthlyLoad.set(k, (monthlyLoad.get(k) ?? 0) + place * weightPerDay)
      remaining -= place
      lastDay = new Date(cur)
    }
    cur.setDate(cur.getDate() + 1)
  }
  const weeks = Math.ceil(expectedDays / 5)
  return { deal, expectedDays, weightedDays, start, end: lastDay, weeks, monthlyLoad }
}

export interface MonthForecast {
  year: number
  month: number
  label: string
  freeDays: number // freie Team-Kapazität (Σ max(0, netAvail − gebucht))
  pipelineLoad: number // gewichtete Pipeline-Last der ausgewählten Deals
  /** Verhältnis Last/frei: 'ok' < 0,7 · 'tight' ≤ 1 · 'over' > 1 · 'none' keine Kapazität */
  health: 'ok' | 'tight' | 'over' | 'none'
}

/** Freie Team-Kapazität je Monat: Σ über Mitarbeiter von max(0, netAvail − gebucht). */
function freeCapacityByMonth(data: AnalyticsData, months: MonthWindow[]): Map<string, number> {
  const free = new Map<string, number>()
  for (const emp of data.employees) {
    const stats = employeeMonthStats(emp, data, months)
    for (const s of stats) {
      const k = monthKey(s.year, s.month)
      free.set(k, (free.get(k) ?? 0) + Math.max(0, s.netAvailDays - s.bookedDays))
    }
  }
  return free
}

/**
 * Monatshorizont für die Kapazitätsleiste: vom aktuellen Monat bis zum spätesten
 * Deal-Ende, mindestens 6, höchstens 24 Monate.
 */
export function forecastHorizon(forecasts: DealForecast[], today = new Date()): MonthWindow[] {
  let maxOffset = 5 // mind. 6 Monate (0..5)
  for (const f of forecasts) {
    if (!f.end) continue
    const off = (f.end.getFullYear() - today.getFullYear()) * 12 + (f.end.getMonth() - today.getMonth())
    if (off > maxOffset) maxOffset = off
  }
  return monthWindow(today, 0, Math.min(maxOffset, 23))
}

/**
 * Stellt die gewichtete Pipeline-Last der ausgewählten Deals der freien
 * Team-Kapazität je Monat gegenüber (Was-wäre-wenn / Kapazitäts-Check).
 */
export function capacityCheck(
  data: AnalyticsData,
  forecasts: DealForecast[],
  months: MonthWindow[],
): MonthForecast[] {
  const free = freeCapacityByMonth(data, months)
  const load = new Map<string, number>()
  for (const f of forecasts) {
    for (const [k, v] of f.monthlyLoad) load.set(k, (load.get(k) ?? 0) + v)
  }
  return months.map((m) => {
    const k = monthKey(m.year, m.month)
    const freeDays = Math.round((free.get(k) ?? 0) * 10) / 10
    const pipelineLoad = Math.round((load.get(k) ?? 0) * 10) / 10
    let health: MonthForecast['health']
    if (freeDays <= 0) health = pipelineLoad > 0 ? 'over' : 'none'
    else if (pipelineLoad > freeDays) health = 'over'
    else if (pipelineLoad > freeDays * 0.7) health = 'tight'
    else health = 'ok'
    return { year: m.year, month: m.month, label: m.label, freeDays, pipelineLoad, health }
  })
}
