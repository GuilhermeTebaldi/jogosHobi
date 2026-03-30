/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, RotateCcw, Play, AlertTriangle, MousePointer2 } from 'lucide-react';

// --- Types & Constants ---

type GameState = 'IDLE' | 'PLAYING' | 'FALLING' | 'GAME_OVER';

interface Block {
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  rotation: number;
  vx: number;
  vy: number;
  isSettled: boolean;
}

interface AutoTracePoint {
  drop: number;
  error: number;
  timestamp: number;
  blockCenterX: number;
  targetX: number;
  triggerX?: number;
  releaseX?: number;
  triggerError?: number;
  releaseError?: number;
  stageReadToRelease?: number;
  stageReleaseToLanding?: number;
  landingShift?: number;
  frameDeltaMs?: number;
  frameBaselineMs?: number;
  frameDriftMs?: number;
  triggerTimestamp?: number;
  triggerPerfMs?: number;
  triggerFrame?: number;
  releaseTimestamp?: number;
  releasePerfMs?: number;
  releaseFrame?: number;
  commandLagMs?: number;
  commandLagPerfMs?: number;
  triggerReleaseFrameGap?: number;
  flightLagMs?: number;
  triggerMode?: 'crossed' | 'near' | 'manual';
}

interface AutoTraceSession {
  id: string;
  startedAt: number;
  endedAt: number;
  reason: 'manual_off' | 'reset' | 'game_over';
  targetX: number;
  points: AutoTracePoint[];
  captureMode?: boolean;
}

interface PendingAutoTelemetry {
  targetX: number;
  triggerX: number;
  triggerError: number;
  releaseX?: number;
  releaseError?: number;
  stageReadToRelease?: number;
  stageReleaseToLanding?: number;
  frameDeltaMs: number;
  frameBaselineMs: number;
  frameDriftMs: number;
  triggerTimestamp: number;
  triggerPerfMs: number;
  triggerFrame: number;
  releaseTimestamp?: number;
  releasePerfMs?: number;
  releaseFrame?: number;
  commandLagMs?: number;
  commandLagPerfMs?: number;
  triggerReleaseFrameGap?: number;
  flightLagMs?: number;
  triggerMode: 'crossed' | 'near' | 'manual';
}

interface AutoTraceDraft {
  startedAt: number | null;
  targetX: number | null;
  points: AutoTracePoint[];
  captureMode?: boolean;
  updatedAt?: number;
}

const BLOCK_SIZE = 60;
const BASE_WIDTH = 120;
const GRAVITY = 0.4;
const SWING_SPEED = 0.03;
const SWING_AMPLITUDE = 150;
const COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', 
  '#F7DC6F', '#BB8FCE', '#82E0AA', '#F1948A', '#85C1E9'
];
const TAP_WINDOW_MS = 380;
const AUTO_DROP_COOLDOWN_MS = 220;
const CAPTURE_AUTO_DROP_COOLDOWN_MS = 120;
const AUTO_TARGET_TOLERANCE = 10;
const AUTO_TRACE_MAX_POINTS = Number.MAX_SAFE_INTEGER;
const AUTO_TRACE_MAX_SESSIONS = Number.MAX_SAFE_INTEGER;
const NORMAL_SPAWN_DELAY_MS = 800;
const CAPTURE_SPAWN_DELAY_MS = 340;
const CAPTURE_SWING_MULTIPLIER = 1.45;
const AUTO_TRACE_STORAGE_KEY = 'torre_auto_trace_sessions_v1';
const AUTO_TRACE_DRAFT_STORAGE_KEY = 'torre_auto_trace_draft_v1';
const AUTO_CAPTURE_MODE_STORAGE_KEY = 'torre_auto_capture_mode_v1';

// --- Utility Functions ---

const getRandomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

const formatPreciseTimestamp = (timestamp: number): string => {
  const date = new Date(timestamp);
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${date.toLocaleString('pt-BR', { hour12: false })}.${ms}`;
};

const loadAutoTraceSessions = (): AutoTraceSession[] => {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(AUTO_TRACE_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((session): session is AutoTraceSession => (
        session &&
        typeof session.id === 'string' &&
        typeof session.startedAt === 'number' &&
        typeof session.endedAt === 'number' &&
        typeof session.reason === 'string' &&
        typeof session.targetX === 'number' &&
        Array.isArray(session.points)
      ));
  } catch {
    return [];
  }
};

const loadAutoTraceDraft = (): AutoTraceDraft | null => {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.localStorage.getItem(AUTO_TRACE_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;

    const points = Array.isArray(parsed.points) ? parsed.points : [];
    const startedAt = typeof parsed.startedAt === 'number' ? parsed.startedAt : null;
    const targetX = typeof parsed.targetX === 'number' ? parsed.targetX : null;
    const captureMode = typeof parsed.captureMode === 'boolean' ? parsed.captureMode : undefined;

    return {
      startedAt,
      targetX,
      points,
      captureMode,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : undefined,
    };
  } catch {
    return null;
  }
};

const loadCaptureModePreference = (): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    const raw = window.localStorage.getItem(AUTO_CAPTURE_MODE_STORAGE_KEY);
    return raw === '1';
  } catch {
    return false;
  }
};

const clampNumber = (value: number, min: number, max: number): number => (
  Math.min(max, Math.max(min, value))
);

const erfApprox = (x: number): number => {
  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * absX);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-absX * absX);
  return sign * y;
};

const normalCdf = (x: number): number => 0.5 * (1 + erfApprox(x / Math.SQRT2));

const chiSquareSurvivalApprox = (x: number, k: number): number => {
  if (!(x > 0) || k <= 0) return 1;
  const z = (Math.pow(x / k, 1 / 3) - (1 - 2 / (9 * k))) / Math.sqrt(2 / (9 * k));
  return clampNumber(1 - normalCdf(z), 0, 1);
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>('IDLE');
  const gameStateRef = useRef<GameState>('IDLE');
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  const [score, setScore] = useState(0);
  const scoreRef = useRef(0);
  useEffect(() => { scoreRef.current = score; }, [score]);

  const [highScore, setHighScore] = useState(0);
  const highScoreRef = useRef(0);
  useEffect(() => { highScoreRef.current = highScore; }, [highScore]);

  const [stability, setStability] = useState(100);
  const stabilityRef = useRef(100);
  useEffect(() => { stabilityRef.current = stability; }, [stability]);

  const [lastPrecision, setLastPrecision] = useState<'PERFECT' | 'GOOD' | 'BAD' | null>(null);
  const [showTutorial, setShowTutorial] = useState(true);
  const handleBackToHub = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event('gamehub:back'));
  }, []);
  const initialDraftRef = useRef<AutoTraceDraft | null>(loadAutoTraceDraft());
  const initialDraft = initialDraftRef.current;
  const [autoDropEnabled, setAutoDropEnabled] = useState(false);
  const [autoDropTargetX, setAutoDropTargetX] = useState<number | null>(() => initialDraft?.targetX ?? null);
  const [autoTrace, setAutoTrace] = useState<AutoTracePoint[]>(() => initialDraft?.points ?? []);
  const [autoTraceStartedAt, setAutoTraceStartedAt] = useState<number | null>(() => initialDraft?.startedAt ?? null);
  const [captureMode, setCaptureMode] = useState<boolean>(() => (
    typeof initialDraft?.captureMode === 'boolean' ? initialDraft.captureMode : loadCaptureModePreference()
  ));
  const [autoTraceSessions, setAutoTraceSessions] = useState<AutoTraceSession[]>(() => loadAutoTraceSessions());
  const [autoTraceNotice, setAutoTraceNotice] = useState<string | null>(null);
  const [liveLabOpen, setLiveLabOpen] = useState(false);
  const [liveLabGlassMode, setLiveLabGlassMode] = useState(false);
  const autoDropEnabledRef = useRef(false);
  const autoDropTargetXRef = useRef<number | null>(null);
  const autoTraceRef = useRef<AutoTracePoint[]>([]);
  const autoTraceStartedAtRef = useRef<number | null>(null);
  const captureModeRef = useRef(false);
  const tapTimestampsRef = useRef<number[]>([]);
  const lastAutoDropTimeRef = useRef(0);
  const prevSwingXRef = useRef<number | null>(null);
  const pendingAutoTelemetryRef = useRef<PendingAutoTelemetry | null>(null);
  const lastFrameTimeRef = useRef<number | null>(null);
  const frameDeltaMsRef = useRef(16.7);
  const frameBaselineMsRef = useRef(16.7);
  const frameDriftMsRef = useRef(0);
  const frameTickRef = useRef(0);
  useEffect(() => { autoDropEnabledRef.current = autoDropEnabled; }, [autoDropEnabled]);
  useEffect(() => { autoDropTargetXRef.current = autoDropTargetX; }, [autoDropTargetX]);
  useEffect(() => { autoTraceRef.current = autoTrace; }, [autoTrace]);
  useEffect(() => { autoTraceStartedAtRef.current = autoTraceStartedAt; }, [autoTraceStartedAt]);
  useEffect(() => { captureModeRef.current = captureMode; }, [captureMode]);

  const lastStoredSession = autoTraceSessions.length > 0 ? autoTraceSessions[0] : null;
  const traceForView = autoTrace.length > 0 ? autoTrace : (lastStoredSession?.points ?? []);
  const activeTraceStartedAt = autoTrace.length > 0 ? autoTraceStartedAt : (lastStoredSession?.startedAt ?? null);
  const activeTraceTargetX = autoTrace.length > 0 ? autoDropTargetX : (lastStoredSession?.targetX ?? null);

  const autoGraph = useMemo(() => {
    const width = 220;
    const height = 112;
    const pad = 10;
    const centerY = height / 2;
    const readTriggerError = (point: AutoTracePoint) => (
      typeof point.triggerError === 'number' ? point.triggerError : point.error
    );
    const readFrameDrift = (point: AutoTracePoint) => (
      typeof point.frameDriftMs === 'number' ? point.frameDriftMs : 0
    );
    const readLandingShift = (point: AutoTracePoint) => (
      typeof point.landingShift === 'number' ? point.landingShift : point.error - readTriggerError(point)
    );
    const toPath = (values: number[], maxAbs: number) => values
      .map((value, index) => {
        const ratio = values.length <= 1 ? 1 : index / (values.length - 1);
        const x = pad + ratio * (width - pad * 2);
        const y = centerY - (value / maxAbs) * (centerY - pad);
        return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');
    const meanAbs = (values: number[]) => {
      if (values.length === 0) return 0;
      return values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length;
    };

    const finalErrors = traceForView.map((point) => point.error);
    const triggerErrors = traceForView.map(readTriggerError);
    const frameDrifts = traceForView.map(readFrameDrift);
    const landingShifts = traceForView.map(readLandingShift);

    const maxAbsError = Math.max(12, ...finalErrors.map((value) => Math.abs(value)));
    const maxAbsTrigger = Math.max(12, ...triggerErrors.map((value) => Math.abs(value)));
    const maxAbsFrame = Math.max(2.5, ...frameDrifts.map((value) => Math.abs(value)));

    const points = finalErrors.map((error, index) => {
      const ratio = finalErrors.length <= 1 ? 1 : index / (finalErrors.length - 1);
      const x = pad + ratio * (width - pad * 2);
      const y = centerY - (error / maxAbsError) * (centerY - pad);
      return { x, y };
    });

    const path = points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(' ');

    const triggerPath = toPath(triggerErrors, maxAbsTrigger);
    const framePath = toPath(frameDrifts, maxAbsFrame);
    const avgTrigger = meanAbs(triggerErrors);
    const avgLanding = meanAbs(landingShifts);
    const avgFrame = meanAbs(frameDrifts);

    let dominantSignal: 'trigger' | 'landing' | 'frame' | null = null;
    if (traceForView.length > 0) {
      const ranking = [
        { id: 'trigger' as const, value: avgTrigger / 10 },
        { id: 'landing' as const, value: avgLanding / 10 },
        { id: 'frame' as const, value: avgFrame / 3 },
      ];
      ranking.sort((a, b) => b.value - a.value);
      dominantSignal = ranking[0].id;
    }

    return {
      width,
      height,
      centerY,
      maxAbsError,
      maxAbsTrigger,
      maxAbsFrame,
      path,
      triggerPath,
      framePath,
      points,
      latest: traceForView.length > 0 ? traceForView[traceForView.length - 1] : null,
      avgTrigger,
      avgLanding,
      avgFrame,
      dominantSignal,
    };
  }, [traceForView]);
  const forensic = useMemo(() => {
    const width = 220;
    const height = 58;
    const pad = 7;
    const centerY = height / 2;
    const baseY = height - pad;
    const emptyResult = {
      width,
      height,
      centerY,
      baseY,
      autoPath: '',
      autoValuesCount: 0,
      autoValues: [] as number[],
      spectrumBars: [] as Array<{ x: number; y: number; h: number; w: number }>,
      spectrumValues: [] as number[],
      corrTrigger: 0,
      corrRelease: 0,
      corrFrame: 0,
      corrLanding: 0,
      flipRate: 0,
      dominantLag: 0,
      dominantLagCorr: 0,
      peakPeriodDrops: 0,
      peakFrequency: 0,
      lagPathTrigger: '',
      lagPathFrame: '',
      lagPathLanding: '',
      lagSeriesTrigger: [] as number[],
      lagSeriesFrame: [] as number[],
      lagSeriesLanding: [] as number[],
      lagBestTrigger: 0,
      lagBestFrame: 0,
      lagBestLanding: 0,
      lagBestTriggerCorr: 0,
      lagBestFrameCorr: 0,
      lagBestLandingCorr: 0,
      phaseBars: [] as Array<{ x: number; w: number; color: string }>,
      phaseSegments: [] as Array<{ startRatio: number; endRatio: number; phase: 'trigger' | 'frame' | 'landing' | 'mixed' }>,
      phaseCounts: { trigger: 0, frame: 0, landing: 0, mixed: 0 },
      phaseSwitches: 0,
      originSupportRatio: 0,
      topEvents: [] as Array<{
        drop: number;
        timestamp: number;
        error: number;
        triggerError: number;
        releaseError: number;
        stageReadToRelease: number;
        stageReleaseToLanding: number;
        frameDriftMs: number;
        landingShift: number;
        score: number;
        side: 'L' | 'R' | '0';
      }>,
      origin: null as 'trigger' | 'frame' | 'landing' | null,
      originConfidence: 0,
      scoreTrigger: 0,
      scoreFrame: 0,
      scoreLanding: 0,
      avgReadToRelease: 0,
      avgReleaseToLanding: 0,
      avgCommandLagMs: 0,
      avgCommandLagPerfMs: 0,
      avgFlightLagMs: 0,
      avgTriggerReleaseFrameGap: 0,
      releaseSameFrameRate: 0,
      releaseDistinctRate: 0,
      firstDeviationStage: 'indefinido' as 'leitura-soltar' | 'soltar-assentar' | 'misto' | 'indefinido',
      ljungBoxQ: 0,
      ljungBoxP: 1,
      ljungBoxLags: 0,
    };

    if (traceForView.length < 4) {
      return emptyResult;
    }

    const errors = traceForView.map((point) => point.error);
    const triggerErrors = traceForView.map((point) => (
      typeof point.triggerError === 'number' ? point.triggerError : point.error
    ));
    const releaseErrors = traceForView.map((point, index) => (
      typeof point.releaseError === 'number' ? point.releaseError : triggerErrors[index]
    ));
    const frameDrifts = traceForView.map((point) => (
      typeof point.frameDriftMs === 'number' ? point.frameDriftMs : 0
    ));
    const landingShifts = traceForView.map((point, index) => (
      typeof point.landingShift === 'number' ? point.landingShift : errors[index] - triggerErrors[index]
    ));
    const stageReadToReleaseSeries = traceForView.map((point, index) => (
      typeof point.stageReadToRelease === 'number' ? point.stageReadToRelease : releaseErrors[index] - triggerErrors[index]
    ));
    const stageReleaseToLandingSeries = traceForView.map((point, index) => (
      typeof point.stageReleaseToLanding === 'number' ? point.stageReleaseToLanding : errors[index] - releaseErrors[index]
    ));
    const commandLagSeries = traceForView
      .map((point) => point.commandLagMs)
      .filter((value): value is number => typeof value === 'number');
    const commandLagPerfSeries = traceForView
      .map((point) => point.commandLagPerfMs)
      .filter((value): value is number => typeof value === 'number');
    const flightLagSeries = traceForView
      .map((point) => point.flightLagMs)
      .filter((value): value is number => typeof value === 'number');
    const triggerReleaseFrameGapSeries = traceForView
      .map((point) => point.triggerReleaseFrameGap)
      .filter((value): value is number => typeof value === 'number');

    const mean = (values: number[]) => (
      values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
    );
    const meanAbs = (values: number[]) => (
      values.length > 0 ? values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length : 0
    );
    const std = (values: number[]) => {
      if (values.length < 2) return 0;
      const m = mean(values);
      const variance = values.reduce((sum, value) => sum + (value - m) ** 2, 0) / values.length;
      return Math.sqrt(variance);
    };
    const correlation = (a: number[], b: number[]) => {
      const n = Math.min(a.length, b.length);
      if (n < 2) return 0;
      const aSlice = a.slice(0, n);
      const bSlice = b.slice(0, n);
      const meanA = mean(aSlice);
      const meanB = mean(bSlice);
      let num = 0;
      let denA = 0;
      let denB = 0;
      for (let i = 0; i < n; i++) {
        const da = aSlice[i] - meanA;
        const db = bSlice[i] - meanB;
        num += da * db;
        denA += da * da;
        denB += db * db;
      }
      const den = Math.sqrt(denA * denB);
      if (den < 1e-9) return 0;
      return num / den;
    };
    const pathFromSeries = (values: number[], maxAbs: number) => values.map((value, index) => {
      const ratio = values.length <= 1 ? 1 : index / (values.length - 1);
      const x = pad + ratio * (width - pad * 2);
      const y = centerY - (value / maxAbs) * (centerY - pad);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(' ');
    const bestLagFromSeries = (values: number[]) => {
      if (values.length === 0) return { lag: 0, corr: 0 };
      let lag = 0;
      let corr = values[0];
      for (let i = 1; i < values.length; i++) {
        if (Math.abs(values[i]) > Math.abs(corr)) {
          lag = i;
          corr = values[i];
        }
      }
      return { lag, corr };
    };
    const crossCorrelationByLag = (signal: number[], driver: number[], maxLag: number) => {
      const values: number[] = [];
      for (let lag = 0; lag <= maxLag; lag++) {
        const n = Math.min(signal.length - lag, driver.length);
        if (n < 3) {
          values.push(0);
          continue;
        }
        const shiftedSignal = signal.slice(lag, lag + n);
        const baseDriver = driver.slice(0, n);
        values.push(correlation(shiftedSignal, baseDriver));
      }
      return values;
    };

    const detrendLinear = (values: number[]) => {
      if (values.length < 2) {
        return values.slice();
      }
      const meanX = (values.length - 1) / 2;
      const meanY = mean(values);
      let covXY = 0;
      let varX = 0;
      for (let i = 0; i < values.length; i++) {
        const dx = i - meanX;
        covXY += dx * (values[i] - meanY);
        varX += dx * dx;
      }
      const slope = varX > 1e-9 ? covXY / varX : 0;
      const intercept = meanY - slope * meanX;
      return values.map((value, index) => value - (intercept + slope * index));
    };

    const detrended = detrendLinear(errors);
    const centered = detrended.map((value) => value - mean(detrended));
    const energy = centered.reduce((sum, value) => sum + value * value, 0);
    const maxLag = Math.min(48, errors.length - 1);
    const autoValues = [1];
    for (let lag = 1; lag <= maxLag; lag++) {
      let num = 0;
      for (let i = 0; i < centered.length - lag; i++) {
        num += centered[i] * centered[i + lag];
      }
      autoValues.push(energy > 1e-9 ? num / energy : 0);
    }

    const maxAbsAuto = Math.max(0.18, ...autoValues.map((value) => Math.abs(value)));
    const autoPath = pathFromSeries(autoValues, maxAbsAuto);

    let dominantLag = 0;
    let dominantLagCorr = 0;
    for (let lag = 1; lag < autoValues.length; lag++) {
      if (Math.abs(autoValues[lag]) > Math.abs(dominantLagCorr)) {
        dominantLagCorr = autoValues[lag];
        dominantLag = lag;
      }
    }

    const ljungBoxLags = Math.max(1, Math.min(20, Math.floor(errors.length / 4), autoValues.length - 1));
    let ljungBoxQ = 0;
    for (let lag = 1; lag <= ljungBoxLags; lag++) {
      const rho = autoValues[lag] ?? 0;
      ljungBoxQ += (rho * rho) / Math.max(1, errors.length - lag);
    }
    ljungBoxQ *= errors.length * (errors.length + 2);
    const ljungBoxP = chiSquareSurvivalApprox(ljungBoxQ, ljungBoxLags);

    const lagScanMax = Math.min(36, errors.length - 3);
    const lagCorrTrigger = crossCorrelationByLag(errors, triggerErrors, lagScanMax);
    const lagCorrFrame = crossCorrelationByLag(errors, frameDrifts, lagScanMax);
    const lagCorrLanding = crossCorrelationByLag(errors, landingShifts, lagScanMax);
    const lagMaxAbs = Math.max(
      0.16,
      ...lagCorrTrigger.map((value) => Math.abs(value)),
      ...lagCorrFrame.map((value) => Math.abs(value)),
      ...lagCorrLanding.map((value) => Math.abs(value)),
    );
    const lagPathTrigger = pathFromSeries(lagCorrTrigger, lagMaxAbs);
    const lagPathFrame = pathFromSeries(lagCorrFrame, lagMaxAbs);
    const lagPathLanding = pathFromSeries(lagCorrLanding, lagMaxAbs);
    const lagBestTrigger = bestLagFromSeries(lagCorrTrigger);
    const lagBestFrame = bestLagFromSeries(lagCorrFrame);
    const lagBestLanding = bestLagFromSeries(lagCorrLanding);

    const n = centered.length;
    const binsCount = Math.min(60, Math.floor(n / 2));
    const bins: Array<{ k: number; amp: number }> = [];
    for (let k = 1; k <= binsCount; k++) {
      let re = 0;
      let im = 0;
      for (let t = 0; t < n; t++) {
        const angle = (2 * Math.PI * k * t) / n;
        re += centered[t] * Math.cos(angle);
        im -= centered[t] * Math.sin(angle);
      }
      const amp = Math.sqrt(re * re + im * im) / n;
      bins.push({ k, amp });
    }

    const maxAmp = Math.max(1e-9, ...bins.map((bin) => bin.amp));
    const barStep = bins.length > 0 ? (width - pad * 2) / bins.length : 0;
    const barWidth = Math.max(1.2, barStep * 0.72);
    const spectrumBars = bins.map((bin, index) => {
      const ampRatio = maxAmp > 0 ? bin.amp / maxAmp : 0;
      const h = ampRatio * (height - pad * 2);
      const x = pad + index * barStep + (barStep - barWidth) / 2;
      const y = baseY - h;
      return { x, y, h, w: barWidth };
    });

    const peakBin = bins.reduce(
      (best, current) => (current.amp > best.amp ? current : best),
      { k: 0, amp: 0 },
    );
    const peakFrequency = peakBin.k > 0 ? peakBin.k / n : 0;
    const peakPeriodDrops = peakBin.k > 0 ? n / peakBin.k : 0;

    let signTransitions = 0;
    let signFlips = 0;
    for (let i = 1; i < errors.length; i++) {
      const a = Math.sign(errors[i - 1]);
      const b = Math.sign(errors[i]);
      if (a !== 0 && b !== 0) {
        signTransitions += 1;
        if (a !== b) signFlips += 1;
      }
    }
    const flipRate = signTransitions > 0 ? signFlips / signTransitions : 0;

    const corrTrigger = correlation(errors, triggerErrors);
    const corrRelease = correlation(errors, releaseErrors);
    const corrFrame = correlation(errors, frameDrifts);
    const corrLanding = correlation(errors, landingShifts);
    const stdErrors = Math.max(1e-6, std(errors));
    const stdFrame = std(frameDrifts);
    const stdLanding = std(landingShifts);
    const avgReadToRelease = meanAbs(stageReadToReleaseSeries);
    const avgReleaseToLanding = meanAbs(stageReleaseToLandingSeries);
    const avgCommandLagMs = mean(commandLagSeries);
    const avgCommandLagPerfMs = mean(commandLagPerfSeries);
    const avgFlightLagMs = mean(flightLagSeries);
    const avgTriggerReleaseFrameGap = mean(triggerReleaseFrameGapSeries);
    const sameFrameReleases = triggerReleaseFrameGapSeries.filter((value) => value === 0).length;
    const releaseSameFrameRate = triggerReleaseFrameGapSeries.length > 0
      ? sameFrameReleases / triggerReleaseFrameGapSeries.length
      : 0;
    const distinctCount = traceForView.reduce((count, point, index) => {
      const stageShift = Math.abs(stageReadToReleaseSeries[index]);
      const perfLag = typeof point.commandLagPerfMs === 'number' ? Math.abs(point.commandLagPerfMs) : 0;
      const frameGap = typeof point.triggerReleaseFrameGap === 'number' ? Math.abs(point.triggerReleaseFrameGap) : 0;
      return stageShift > 0.05 || perfLag > 0.2 || frameGap > 0 ? count + 1 : count;
    }, 0);
    const releaseDistinctRate = traceForView.length > 0 ? distinctCount / traceForView.length : 0;
    const stageDelta = Math.abs(avgReadToRelease - avgReleaseToLanding);
    const maxStage = Math.max(avgReadToRelease, avgReleaseToLanding, 1e-6);
    const firstDeviationStage: 'leitura-soltar' | 'soltar-assentar' | 'misto' = stageDelta / maxStage < 0.14
      ? 'misto'
      : avgReadToRelease > avgReleaseToLanding
        ? 'leitura-soltar'
        : 'soltar-assentar';

    const windowSize = 24;
    const phaseBars: Array<{ x: number; w: number; color: string }> = [];
    const phaseSegments: Array<{ startRatio: number; endRatio: number; phase: 'trigger' | 'frame' | 'landing' | 'mixed' }> = [];
    const phaseCounts = { trigger: 0, frame: 0, landing: 0, mixed: 0 };
    for (let start = 0; start < errors.length; start += windowSize) {
      const end = Math.min(errors.length, start + windowSize);
      if (end - start < 6) continue;
      const e = errors.slice(start, end);
      const t = triggerErrors.slice(start, end);
      const f = frameDrifts.slice(start, end);
      const l = landingShifts.slice(start, end);
      const ranked = [
        { id: 'trigger' as const, value: Math.abs(correlation(e, t)) },
        { id: 'frame' as const, value: Math.abs(correlation(e, f)) },
        { id: 'landing' as const, value: Math.abs(correlation(e, l)) },
      ].sort((a, b) => b.value - a.value);
      const phase: 'trigger' | 'frame' | 'landing' | 'mixed' = ranked[0].value - ranked[1].value < 0.1 ? 'mixed' : ranked[0].id;
      phaseCounts[phase] += 1;
      const startRatio = start / errors.length;
      const endRatio = end / errors.length;
      const x = pad + (start / errors.length) * (width - pad * 2);
      const w = Math.max(2, ((end - start) / errors.length) * (width - pad * 2));
      const color = phase === 'trigger'
        ? '#f59e0b'
        : phase === 'frame'
          ? '#f472b6'
          : phase === 'landing'
            ? '#34d399'
            : '#94a3b8';
      phaseBars.push({ x, w, color });
      phaseSegments.push({ startRatio, endRatio, phase });
    }
    let phaseSwitches = 0;
    for (let i = 1; i < phaseSegments.length; i++) {
      if (phaseSegments[i].phase !== phaseSegments[i - 1].phase) {
        phaseSwitches += 1;
      }
    }

    const absErrors = errors.map((value) => Math.abs(value));
    const zDenError = Math.max(1e-6, std(absErrors));
    const zDenFrame = Math.max(1e-6, std(frameDrifts.map((value) => Math.abs(value))));
    const zDenLanding = Math.max(1e-6, std(landingShifts.map((value) => Math.abs(value))));
    const topEvents = traceForView.map((point, index) => {
      const error = errors[index];
      const triggerError = triggerErrors[index];
      const releaseError = releaseErrors[index];
      const stageReadToRelease = stageReadToReleaseSeries[index];
      const stageReleaseToLanding = stageReleaseToLandingSeries[index];
      const frameDriftMs = frameDrifts[index];
      const landingShift = landingShifts[index];
      const zError = Math.abs(error) / zDenError;
      const zFrame = Math.abs(frameDriftMs) / zDenFrame;
      const zLanding = Math.abs(landingShift) / zDenLanding;
      const flipBonus = index > 0 && Math.sign(errors[index - 1]) !== Math.sign(error) ? 0.35 : 0;
      const score = zError * 1.15 + zLanding * 0.85 + zFrame * 0.7 + flipBonus;
      return {
        drop: point.drop,
        timestamp: point.timestamp,
        error,
        triggerError,
        releaseError,
        stageReadToRelease,
        stageReleaseToLanding,
        frameDriftMs,
        landingShift,
        score,
        side: error > 0 ? 'R' as const : error < 0 ? 'L' as const : '0' as const,
      };
    }).sort((a, b) => b.score - a.score).slice(0, 5);

    const scores = [
      { id: 'trigger' as const, score: Math.abs(corrTrigger) * 1.2 + Math.abs(lagBestTrigger.corr) * 0.8 + flipRate * 0.4 },
      { id: 'frame' as const, score: Math.abs(corrFrame) * 1.1 + Math.abs(lagBestFrame.corr) * 0.9 + (stdFrame / stdErrors) * 0.45 },
      { id: 'landing' as const, score: Math.abs(corrLanding) * 1.05 + Math.abs(lagBestLanding.corr) * 0.9 + (stdLanding / stdErrors) * 0.42 },
    ].sort((a, b) => b.score - a.score);

    const top = scores[0];
    const second = scores[1];
    const originConfidence = Math.max(0, Math.min(1, top.score - second.score));
    const totalScore = Math.max(1e-9, scores.reduce((sum, item) => sum + item.score, 0));
    const scoreById = {
      trigger: (scores.find((item) => item.id === 'trigger')?.score ?? 0) / totalScore,
      frame: (scores.find((item) => item.id === 'frame')?.score ?? 0) / totalScore,
      landing: (scores.find((item) => item.id === 'landing')?.score ?? 0) / totalScore,
    };
    const phaseWindowsCount = phaseCounts.trigger + phaseCounts.frame + phaseCounts.landing + phaseCounts.mixed;
    const originSupportRatio = phaseWindowsCount > 0 && top
      ? phaseCounts[top.id] / phaseWindowsCount
      : 0;

    return {
      width,
      height,
      centerY,
      baseY,
      autoPath,
      autoValuesCount: autoValues.length,
      autoValues,
      spectrumBars,
      spectrumValues: bins.map((bin) => bin.amp),
      corrTrigger,
      corrRelease,
      corrFrame,
      corrLanding,
      flipRate,
      dominantLag,
      dominantLagCorr,
      peakPeriodDrops,
      peakFrequency,
      lagPathTrigger,
      lagPathFrame,
      lagPathLanding,
      lagSeriesTrigger: lagCorrTrigger,
      lagSeriesFrame: lagCorrFrame,
      lagSeriesLanding: lagCorrLanding,
      lagBestTrigger: lagBestTrigger.lag,
      lagBestFrame: lagBestFrame.lag,
      lagBestLanding: lagBestLanding.lag,
      lagBestTriggerCorr: lagBestTrigger.corr,
      lagBestFrameCorr: lagBestFrame.corr,
      lagBestLandingCorr: lagBestLanding.corr,
      phaseBars,
      phaseSegments,
      phaseCounts,
      phaseSwitches,
      originSupportRatio,
      topEvents,
      origin: top.id,
      originConfidence,
      scoreTrigger: scoreById.trigger,
      scoreFrame: scoreById.frame,
      scoreLanding: scoreById.landing,
      avgReadToRelease,
      avgReleaseToLanding,
      avgCommandLagMs,
      avgCommandLagPerfMs,
      avgFlightLagMs,
      avgTriggerReleaseFrameGap,
      releaseSameFrameRate,
      releaseDistinctRate,
      firstDeviationStage,
      ljungBoxQ,
      ljungBoxP,
      ljungBoxLags,
    };
  }, [traceForView]);
  const showAutoPanel = autoDropEnabled || traceForView.length > 0;
  const latestTriggerValue = autoGraph.latest
    ? (typeof autoGraph.latest.triggerError === 'number' ? autoGraph.latest.triggerError : autoGraph.latest.error)
    : null;
  const latestFrameDriftValue = autoGraph.latest && typeof autoGraph.latest.frameDriftMs === 'number'
    ? autoGraph.latest.frameDriftMs
    : null;
  const dominantSignalLabel = autoGraph.dominantSignal === 'frame'
    ? 'Frame/tempo'
    : autoGraph.dominantSignal === 'landing'
      ? 'Queda/fisica'
      : autoGraph.dominantSignal === 'trigger'
        ? 'Disparo auto'
        : '--';
  const captureModeLabel = captureMode ? 'Captura rapida' : 'Captura normal';
  const currentAutoCooldown = captureMode ? CAPTURE_AUTO_DROP_COOLDOWN_MS : AUTO_DROP_COOLDOWN_MS;
  const currentSpawnDelay = captureMode ? CAPTURE_SPAWN_DELAY_MS : NORMAL_SPAWN_DELAY_MS;
  const forensicOriginLabel = forensic.origin === 'frame'
    ? 'Tempo/frame'
    : forensic.origin === 'landing'
      ? 'Queda/colisao'
      : forensic.origin === 'trigger'
        ? 'Disparo/limiar'
        : '--';
  const maxSpectrumValue = Math.max(1e-9, ...forensic.spectrumValues);
  const forensicScorePct = (forensic.originConfidence * 100).toFixed(0);
  const forensicLjungPLabel = forensic.ljungBoxP < 0.001
    ? forensic.ljungBoxP.toExponential(1)
    : forensic.ljungBoxP.toFixed(3);
  const forensicTemporalLabel = forensic.ljungBoxP < 0.01
    ? 'forte'
    : forensic.ljungBoxP < 0.05
      ? 'moderada'
      : 'fraca';
  const firstDeviationStageLabel = forensic.firstDeviationStage === 'leitura-soltar'
    ? 'leitura->soltar'
    : forensic.firstDeviationStage === 'soltar-assentar'
      ? 'soltar->assentar'
      : forensic.firstDeviationStage === 'misto'
        ? 'misto'
        : '--';

  const finalizeAutoTraceSession = useCallback((reason: AutoTraceSession['reason']) => {
    const points = autoTraceRef.current;
    const startedAt = autoTraceStartedAtRef.current;
    const targetX = autoDropTargetXRef.current;

    if (startedAt === null || targetX === null || points.length === 0) {
      setAutoTraceStartedAt(null);
      return;
    }

    const session: AutoTraceSession = {
      id: `${startedAt}-${Date.now()}`,
      startedAt,
      endedAt: Date.now(),
      reason,
      targetX,
      points,
      captureMode: captureModeRef.current,
    };

    setAutoTraceSessions((prev) => [session, ...prev]);
    setAutoTraceStartedAt(null);
  }, []);

  const setNotice = useCallback((message: string) => {
    setAutoTraceNotice(message);
    window.setTimeout(() => setAutoTraceNotice((current) => (current === message ? null : current)), 2200);
  }, []);

  const downloadTextFile = useCallback((filename: string, content: string) => {
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }, []);

  const handleDownloadJson = useCallback(() => {
    if (traceForView.length === 0) {
      setNotice('Sem dados para baixar');
      return;
    }

    const payload = {
      exportedAt: Date.now(),
      exportedAtFormatted: formatPreciseTimestamp(Date.now()),
      source: autoTrace.length > 0 ? 'active' : 'stored_session',
      captureMode,
      samplingProfile: {
        maxPoints: 'infinite',
        autoCooldownMs: currentAutoCooldown,
        spawnDelayMs: currentSpawnDelay,
      },
      startedAt: activeTraceStartedAt,
      startedAtFormatted: activeTraceStartedAt ? formatPreciseTimestamp(activeTraceStartedAt) : null,
      targetX: activeTraceTargetX,
      dominantSignal: autoGraph.dominantSignal,
      summary: {
        avgTriggerPx: autoGraph.avgTrigger,
        avgLandingShiftPx: autoGraph.avgLanding,
        avgFrameDriftMs: autoGraph.avgFrame,
        avgReadToReleasePx: forensic.avgReadToRelease,
        avgReleaseToLandingPx: forensic.avgReleaseToLanding,
        avgCommandLagMs: forensic.avgCommandLagMs,
        avgCommandLagPerfMs: forensic.avgCommandLagPerfMs,
        avgFlightLagMs: forensic.avgFlightLagMs,
        avgTriggerReleaseFrameGap: forensic.avgTriggerReleaseFrameGap,
        releaseSameFrameRate: forensic.releaseSameFrameRate,
        releaseDistinctRate: forensic.releaseDistinctRate,
        firstDeviationStage: forensic.firstDeviationStage,
        forensicOrigin: forensic.origin,
        heuristicScore: forensic.originConfidence,
        heuristicBreakdown: {
          trigger: forensic.scoreTrigger,
          frame: forensic.scoreFrame,
          landing: forensic.scoreLanding,
        },
        originSupportRatio: forensic.originSupportRatio,
        corrErrorTrigger: forensic.corrTrigger,
        corrErrorRelease: forensic.corrRelease,
        corrErrorFrame: forensic.corrFrame,
        corrErrorLanding: forensic.corrLanding,
        signFlipRate: forensic.flipRate,
        dominantLagDrops: forensic.dominantLag,
        dominantLagCorr: forensic.dominantLagCorr,
        dominantPeriodDrops: forensic.peakPeriodDrops,
        dominantFrequencyCyclesPerDrop: forensic.peakFrequency,
        lagTriggerBest: { lag: forensic.lagBestTrigger, corr: forensic.lagBestTriggerCorr },
        lagFrameBest: { lag: forensic.lagBestFrame, corr: forensic.lagBestFrameCorr },
        lagLandingBest: { lag: forensic.lagBestLanding, corr: forensic.lagBestLandingCorr },
        phaseCounts: forensic.phaseCounts,
        phaseSwitches: forensic.phaseSwitches,
        ljungBox: {
          q: forensic.ljungBoxQ,
          p: forensic.ljungBoxP,
          lags: forensic.ljungBoxLags,
        },
        topEvents: forensic.topEvents,
      },
      fullHistory: {
        activeTracePoints: autoTrace,
        sessions: autoTraceSessions,
        sessionsCount: autoTraceSessions.length,
        totalPoints: autoTrace.length + autoTraceSessions.reduce((sum, session) => sum + session.points.length, 0),
      },
      points: traceForView,
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadTextFile(`torre-auto-trace-${stamp}.json`, JSON.stringify(payload, null, 2));
    setNotice('JSON baixado');
  }, [activeTraceStartedAt, activeTraceTargetX, autoGraph.avgFrame, autoGraph.avgLanding, autoGraph.avgTrigger, autoGraph.dominantSignal, autoTrace, autoTraceSessions, captureMode, currentAutoCooldown, currentSpawnDelay, downloadTextFile, forensic.avgCommandLagMs, forensic.avgCommandLagPerfMs, forensic.avgFlightLagMs, forensic.avgReadToRelease, forensic.avgReleaseToLanding, forensic.avgTriggerReleaseFrameGap, forensic.corrFrame, forensic.corrLanding, forensic.corrRelease, forensic.corrTrigger, forensic.dominantLag, forensic.dominantLagCorr, forensic.firstDeviationStage, forensic.flipRate, forensic.lagBestFrame, forensic.lagBestFrameCorr, forensic.lagBestLanding, forensic.lagBestLandingCorr, forensic.lagBestTrigger, forensic.lagBestTriggerCorr, forensic.ljungBoxLags, forensic.ljungBoxP, forensic.ljungBoxQ, forensic.origin, forensic.originConfidence, forensic.originSupportRatio, forensic.phaseCounts, forensic.phaseSwitches, forensic.peakFrequency, forensic.peakPeriodDrops, forensic.releaseDistinctRate, forensic.releaseSameFrameRate, forensic.scoreFrame, forensic.scoreLanding, forensic.scoreTrigger, forensic.topEvents, setNotice, traceForView]);

  const handleCopyJson = useCallback(async () => {
    if (traceForView.length === 0) {
      setNotice('Sem dados para copiar');
      return;
    }

    const payload = {
      copiedAt: Date.now(),
      copiedAtFormatted: formatPreciseTimestamp(Date.now()),
      source: autoTrace.length > 0 ? 'active' : 'stored_session',
      captureMode,
      samplingProfile: {
        maxPoints: 'infinite',
        autoCooldownMs: currentAutoCooldown,
        spawnDelayMs: currentSpawnDelay,
      },
      startedAt: activeTraceStartedAt,
      startedAtFormatted: activeTraceStartedAt ? formatPreciseTimestamp(activeTraceStartedAt) : null,
      targetX: activeTraceTargetX,
      dominantSignal: autoGraph.dominantSignal,
      summary: {
        avgTriggerPx: autoGraph.avgTrigger,
        avgLandingShiftPx: autoGraph.avgLanding,
        avgFrameDriftMs: autoGraph.avgFrame,
        avgReadToReleasePx: forensic.avgReadToRelease,
        avgReleaseToLandingPx: forensic.avgReleaseToLanding,
        avgCommandLagMs: forensic.avgCommandLagMs,
        avgCommandLagPerfMs: forensic.avgCommandLagPerfMs,
        avgFlightLagMs: forensic.avgFlightLagMs,
        avgTriggerReleaseFrameGap: forensic.avgTriggerReleaseFrameGap,
        releaseSameFrameRate: forensic.releaseSameFrameRate,
        releaseDistinctRate: forensic.releaseDistinctRate,
        firstDeviationStage: forensic.firstDeviationStage,
        forensicOrigin: forensic.origin,
        heuristicScore: forensic.originConfidence,
        heuristicBreakdown: {
          trigger: forensic.scoreTrigger,
          frame: forensic.scoreFrame,
          landing: forensic.scoreLanding,
        },
        originSupportRatio: forensic.originSupportRatio,
        corrErrorTrigger: forensic.corrTrigger,
        corrErrorRelease: forensic.corrRelease,
        corrErrorFrame: forensic.corrFrame,
        corrErrorLanding: forensic.corrLanding,
        signFlipRate: forensic.flipRate,
        dominantLagDrops: forensic.dominantLag,
        dominantLagCorr: forensic.dominantLagCorr,
        dominantPeriodDrops: forensic.peakPeriodDrops,
        dominantFrequencyCyclesPerDrop: forensic.peakFrequency,
        lagTriggerBest: { lag: forensic.lagBestTrigger, corr: forensic.lagBestTriggerCorr },
        lagFrameBest: { lag: forensic.lagBestFrame, corr: forensic.lagBestFrameCorr },
        lagLandingBest: { lag: forensic.lagBestLanding, corr: forensic.lagBestLandingCorr },
        phaseCounts: forensic.phaseCounts,
        phaseSwitches: forensic.phaseSwitches,
        ljungBox: {
          q: forensic.ljungBoxQ,
          p: forensic.ljungBoxP,
          lags: forensic.ljungBoxLags,
        },
        topEvents: forensic.topEvents,
      },
      fullHistory: {
        activeTracePoints: autoTrace,
        sessions: autoTraceSessions,
        sessionsCount: autoTraceSessions.length,
        totalPoints: autoTrace.length + autoTraceSessions.reduce((sum, session) => sum + session.points.length, 0),
      },
      points: traceForView,
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setNotice('Dados copiados');
    } catch {
      setNotice('Falha ao copiar');
    }
  }, [activeTraceStartedAt, activeTraceTargetX, autoGraph.avgFrame, autoGraph.avgLanding, autoGraph.avgTrigger, autoGraph.dominantSignal, autoTrace, autoTraceSessions, captureMode, currentAutoCooldown, currentSpawnDelay, forensic.avgCommandLagMs, forensic.avgCommandLagPerfMs, forensic.avgFlightLagMs, forensic.avgReadToRelease, forensic.avgReleaseToLanding, forensic.avgTriggerReleaseFrameGap, forensic.corrFrame, forensic.corrLanding, forensic.corrRelease, forensic.corrTrigger, forensic.dominantLag, forensic.dominantLagCorr, forensic.firstDeviationStage, forensic.flipRate, forensic.lagBestFrame, forensic.lagBestFrameCorr, forensic.lagBestLanding, forensic.lagBestLandingCorr, forensic.lagBestTrigger, forensic.lagBestTriggerCorr, forensic.ljungBoxLags, forensic.ljungBoxP, forensic.ljungBoxQ, forensic.origin, forensic.originConfidence, forensic.originSupportRatio, forensic.phaseCounts, forensic.phaseSwitches, forensic.peakFrequency, forensic.peakPeriodDrops, forensic.releaseDistinctRate, forensic.releaseSameFrameRate, forensic.scoreFrame, forensic.scoreLanding, forensic.scoreTrigger, forensic.topEvents, setNotice, traceForView]);

  const handleDownloadPoster = useCallback(() => {
    if (traceForView.length < 2) {
      setNotice('Dados insuficientes para cartaz');
      return;
    }

    const readTriggerError = (point: AutoTracePoint) => (
      typeof point.triggerError === 'number' ? point.triggerError : point.error
    );
    const readReleaseError = (point: AutoTracePoint, triggerError: number) => (
      typeof point.releaseError === 'number' ? point.releaseError : triggerError
    );
    const readFrameDrift = (point: AutoTracePoint) => (
      typeof point.frameDriftMs === 'number' ? point.frameDriftMs : 0
    );
    const errors = traceForView.map((point) => point.error);
    const triggerErrors = traceForView.map(readTriggerError);
    const releaseErrors = traceForView.map((point, index) => readReleaseError(point, triggerErrors[index]));
    const stageReadToRelease = traceForView.map((point, index) => (
      typeof point.stageReadToRelease === 'number' ? point.stageReadToRelease : releaseErrors[index] - triggerErrors[index]
    ));
    const stageReleaseToLanding = traceForView.map((point, index) => (
      typeof point.stageReleaseToLanding === 'number' ? point.stageReleaseToLanding : errors[index] - releaseErrors[index]
    ));
    const frameDrifts = traceForView.map(readFrameDrift);
    const maxAbsError = Math.max(12, ...errors.map((value) => Math.abs(value)));
    const maxAbsTrigger = Math.max(12, ...triggerErrors.map((value) => Math.abs(value)));
    const maxAbsRelease = Math.max(12, ...releaseErrors.map((value) => Math.abs(value)));
    const maxAbsFrame = Math.max(2.5, ...frameDrifts.map((value) => Math.abs(value)));
    const maxAbsStage = Math.max(
      6,
      ...stageReadToRelease.map((value) => Math.abs(value)),
      ...stageReleaseToLanding.map((value) => Math.abs(value)),
    );
    const maxAbsAuto = Math.max(0.18, ...forensic.autoValues.map((value) => Math.abs(value)));
    const maxAbsLag = Math.max(
      0.16,
      ...forensic.lagSeriesTrigger.map((value) => Math.abs(value)),
      ...forensic.lagSeriesFrame.map((value) => Math.abs(value)),
      ...forensic.lagSeriesLanding.map((value) => Math.abs(value)),
    );
    const maxSpectrum = Math.max(1e-9, ...forensic.spectrumValues);

    const posterWidth = 2000;
    const posterHeight = 3200;
    const deviceRatio = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const renderScale = Math.min(3, Math.max(2.2, deviceRatio * 1.5));
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(posterWidth * renderScale);
    canvas.height = Math.floor(posterHeight * renderScale);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setNotice('Falha ao gerar cartaz');
      return;
    }
    ctx.scale(renderScale, renderScale);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    const gradient = ctx.createLinearGradient(0, 0, posterWidth, posterHeight);
    gradient.addColorStop(0, '#0b132a');
    gradient.addColorStop(1, '#1f2a44');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, posterWidth, posterHeight);

    const drawCard = (x: number, y: number, w: number, h: number, title: string, subtitle?: string) => {
      ctx.fillStyle = 'rgba(15, 23, 42, 0.72)';
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.36)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 18);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#e2e8f0';
      ctx.font = '800 28px system-ui, -apple-system, Segoe UI, sans-serif';
      ctx.fillText(title, x + 20, y + 38);
      if (subtitle) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '700 17px system-ui, -apple-system, Segoe UI, sans-serif';
        ctx.fillText(subtitle, x + 20, y + 64);
      }
      return {
        x: x + 18,
        y: y + (subtitle ? 82 : 56),
        w: w - 36,
        h: h - (subtitle ? 102 : 76),
      };
    };

    const drawSeries = (
      area: { x: number; y: number; w: number; h: number },
      values: number[],
      maxAbs: number,
      color: string,
      widthPx: number,
      dashed: number[] = [],
      withDots = false,
      baseline = true,
    ) => {
      if (values.length === 0) return;
      const centerY = area.y + area.h / 2;
      const pad = 8;
      if (baseline) {
        ctx.beginPath();
        ctx.setLineDash([7, 7]);
        ctx.moveTo(area.x, centerY);
        ctx.lineTo(area.x + area.w, centerY);
        ctx.strokeStyle = 'rgba(226,232,240,0.24)';
        ctx.lineWidth = 1.6;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.beginPath();
      values.forEach((value, index) => {
        const ratio = values.length <= 1 ? 1 : index / (values.length - 1);
        const x = area.x + ratio * area.w;
        const y = centerY - (value / maxAbs) * (area.h / 2 - pad);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = widthPx;
      ctx.setLineDash(dashed);
      ctx.stroke();
      ctx.setLineDash([]);
      if (!withDots) return;
      ctx.fillStyle = color;
      values.forEach((value, index) => {
        const ratio = values.length <= 1 ? 1 : index / (values.length - 1);
        const x = area.x + ratio * area.w;
        const y = centerY - (value / maxAbs) * (area.h / 2 - pad);
        ctx.beginPath();
        ctx.arc(x, y, 2.4, 0, Math.PI * 2);
        ctx.fill();
      });
    };

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '900 58px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillText('TORRE - LAB FORENSE AO VIVO', 72, 82);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '700 24px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillText(`Inicio: ${activeTraceStartedAt ? formatPreciseTimestamp(activeTraceStartedAt) : '--'}`, 72, 118);
    ctx.fillText(`Ultimo ponto: ${formatPreciseTimestamp(traceForView[traceForView.length - 1].timestamp)}`, 72, 148);

    const mainArea = drawCard(70, 176, 1860, 780, 'Sinal Principal', 'Erro final + trigger + soltar + frame');
    drawSeries(mainArea, errors, maxAbsError, '#22d3ee', 4.2, [], true, true);
    drawSeries(mainArea, triggerErrors, maxAbsTrigger, '#f59e0b', 2.6, [9, 6], false, false);
    drawSeries(mainArea, releaseErrors, maxAbsRelease, '#a3e635', 2.4, [6, 4], false, false);
    drawSeries(mainArea, frameDrifts, maxAbsFrame, '#f472b6', 2.2, [3, 6], false, false);

    const miniTop = 995;
    const cardW = 597;
    const gap = 34;
    const autoArea = drawCard(70, miniTop, cardW, 360, 'Autocorrelacao', `lag ${forensic.dominantLag} | r ${forensic.dominantLagCorr.toFixed(2)}`);
    drawSeries(autoArea, forensic.autoValues, maxAbsAuto, '#34d399', 2.7, [], false, true);

    const spectrumArea = drawCard(70 + cardW + gap, miniTop, cardW, 360, 'Espectro', `periodo ${forensic.peakPeriodDrops > 0 ? forensic.peakPeriodDrops.toFixed(1) : '--'} drops`);
    ctx.beginPath();
    ctx.moveTo(spectrumArea.x, spectrumArea.y + spectrumArea.h);
    ctx.lineTo(spectrumArea.x + spectrumArea.w, spectrumArea.y + spectrumArea.h);
    ctx.strokeStyle = 'rgba(226,232,240,0.25)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    const barStep = forensic.spectrumValues.length > 0 ? spectrumArea.w / forensic.spectrumValues.length : 0;
    const barWidth = Math.max(1.6, barStep * 0.72);
    forensic.spectrumValues.forEach((value, index) => {
      const h = (value / maxSpectrum) * (spectrumArea.h - 8);
      const x = spectrumArea.x + index * barStep + (barStep - barWidth) / 2;
      const y = spectrumArea.y + spectrumArea.h - h;
      ctx.fillStyle = '#38bdf8';
      ctx.fillRect(x, y, barWidth, h);
    });

    const lagArea = drawCard(70 + (cardW + gap) * 2, miniTop, cardW, 360, 'Lag Scanner', `T ${forensic.lagBestTrigger}/${forensic.lagBestTriggerCorr.toFixed(2)} | F ${forensic.lagBestFrame}/${forensic.lagBestFrameCorr.toFixed(2)} | Q ${forensic.lagBestLanding}/${forensic.lagBestLandingCorr.toFixed(2)}`);
    drawSeries(lagArea, forensic.lagSeriesTrigger, maxAbsLag, '#f59e0b', 2.3, [], false, true);
    drawSeries(lagArea, forensic.lagSeriesFrame, maxAbsLag, '#f472b6', 2.1, [5, 4], false, false);
    drawSeries(lagArea, forensic.lagSeriesLanding, maxAbsLag, '#34d399', 2.1, [2, 4], false, false);

    const regimeArea = drawCard(70, 1420, 1160, 360, 'Mapa de Regime', `T ${forensic.phaseCounts.trigger} | F ${forensic.phaseCounts.frame} | Q ${forensic.phaseCounts.landing} | M ${forensic.phaseCounts.mixed}`);
    ctx.fillStyle = 'rgba(30,41,59,0.9)';
    ctx.fillRect(regimeArea.x, regimeArea.y + 28, regimeArea.w, 44);
    forensic.phaseSegments.forEach((segment) => {
      const x = regimeArea.x + segment.startRatio * regimeArea.w;
      const w = Math.max(2, (segment.endRatio - segment.startRatio) * regimeArea.w);
      const color = segment.phase === 'trigger'
        ? '#f59e0b'
        : segment.phase === 'frame'
          ? '#f472b6'
          : segment.phase === 'landing'
            ? '#34d399'
            : '#94a3b8';
      ctx.fillStyle = color;
      ctx.fillRect(x, regimeArea.y + 32, w, 36);
    });
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '700 16px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillText(`Hipotese origem: ${forensicOriginLabel} | score ${(forensic.originConfidence * 100).toFixed(0)}%`, regimeArea.x, regimeArea.y + 104);
    ctx.fillText(`Corr E/T/S/F/Q: ${forensic.corrTrigger.toFixed(2)} / ${forensic.corrRelease.toFixed(2)} / ${forensic.corrFrame.toFixed(2)} / ${forensic.corrLanding.toFixed(2)}`, regimeArea.x, regimeArea.y + 132);
    ctx.fillText(`Troca de lado: ${(forensic.flipRate * 100).toFixed(0)}% | trocas de regime: ${forensic.phaseSwitches}`, regimeArea.x, regimeArea.y + 160);
    ctx.fillText(`Ljung-Box p=${forensicLjungPLabel} (lag ${forensic.ljungBoxLags}) | suporte janela ${(forensic.originSupportRatio * 100).toFixed(0)}%`, regimeArea.x, regimeArea.y + 188);

    const eventsArea = drawCard(1268, 1420, 662, 360, 'Top Eventos', 'Picos mais fortes');
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '700 14px system-ui, -apple-system, Segoe UI, sans-serif';
    forensic.topEvents.slice(0, 7).forEach((event, index) => {
      const y = eventsArea.y + 22 + index * 34;
      ctx.fillText(
        `#${event.drop} ${event.side} ${formatPreciseTimestamp(event.timestamp)} | s ${event.score.toFixed(2)} | e ${event.error.toFixed(1)}px`,
        eventsArea.x,
        y,
      );
    });

    const pipelineArea = drawCard(70, 1820, 1860, 360, 'Pipeline do Erro', `Etapa inicial ${firstDeviationStageLabel} | L-S ${forensic.avgReadToRelease.toFixed(2)}px | S-A ${forensic.avgReleaseToLanding.toFixed(2)}px`);
    drawSeries(pipelineArea, stageReadToRelease, maxAbsStage, '#fb7185', 2.5, [6, 4], false, true);
    drawSeries(pipelineArea, stageReleaseToLanding, maxAbsStage, '#34d399', 2.5, [2, 5], false, false);
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '700 16px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillText(`Corr erro/disparo ${forensic.corrTrigger.toFixed(2)} | erro/soltar ${forensic.corrRelease.toFixed(2)} | erro/frame ${forensic.corrFrame.toFixed(2)} | erro/queda ${forensic.corrLanding.toFixed(2)}`, pipelineArea.x, pipelineArea.y + pipelineArea.h - 8);

    const summaryArea = drawCard(70, 2220, 1860, 930, 'Resumo Expandido', 'Métricas e contexto de captura');
    const latest = traceForView[traceForView.length - 1];
    const latestTrigger = typeof latest.triggerError === 'number' ? latest.triggerError : latest.error;
    const latestRelease = typeof latest.releaseError === 'number' ? latest.releaseError : latestTrigger;
    const latestFrame = typeof latest.frameDriftMs === 'number' ? latest.frameDriftMs : 0;
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '800 28px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillText(`Pontos: ${traceForView.length}`, summaryArea.x, summaryArea.y + 34);
    ctx.fillText(`Escala: ±${maxAbsError.toFixed(1)}px`, summaryArea.x + 360, summaryArea.y + 34);
    ctx.fillText(`Alvo X: ${latest.targetX.toFixed(1)}px`, summaryArea.x + 760, summaryArea.y + 34);
    ctx.fillText(`Modo captura: ${captureMode ? 'ON' : 'OFF'}`, summaryArea.x + 1160, summaryArea.y + 34);
    ctx.fillText(`Erro final: ${latest.error.toFixed(2)}px`, summaryArea.x, summaryArea.y + 78);
    ctx.fillText(`Trigger: ${latestTrigger.toFixed(2)}px`, summaryArea.x + 360, summaryArea.y + 78);
    ctx.fillText(`Soltar: ${latestRelease.toFixed(2)}px`, summaryArea.x + 760, summaryArea.y + 78);
    ctx.fillText(`Frame drift: ${latestFrame.toFixed(3)}ms`, summaryArea.x + 1160, summaryArea.y + 78);
    ctx.fillText(`Dominante: ${autoGraph.dominantSignal ?? '--'} / ${forensicOriginLabel}`, summaryArea.x, summaryArea.y + 342);
    ctx.fillText(`Média disparo: ${autoGraph.avgTrigger.toFixed(2)}px`, summaryArea.x, summaryArea.y + 122);
    ctx.fillText(`Média queda: ${autoGraph.avgLanding.toFixed(2)}px`, summaryArea.x + 360, summaryArea.y + 122);
    ctx.fillText(`Média frame: ${autoGraph.avgFrame.toFixed(3)}ms`, summaryArea.x + 760, summaryArea.y + 122);
    ctx.fillText(`Lag dom: ${forensic.dominantLag} / ${forensic.dominantLagCorr.toFixed(2)}`, summaryArea.x + 1160, summaryArea.y + 122);
    ctx.fillText(`Estrutura temporal: ${forensicTemporalLabel} | p ${forensicLjungPLabel}`, summaryArea.x, summaryArea.y + 166);
    ctx.fillText(`Score T/F/Q: ${(forensic.scoreTrigger * 100).toFixed(0)}% / ${(forensic.scoreFrame * 100).toFixed(0)}% / ${(forensic.scoreLanding * 100).toFixed(0)}%`, summaryArea.x + 500, summaryArea.y + 166);
    ctx.fillText(`Suporte por janela: ${(forensic.originSupportRatio * 100).toFixed(0)}%`, summaryArea.x + 1160, summaryArea.y + 166);
    ctx.fillText(`Etapa inicial: ${firstDeviationStageLabel}`, summaryArea.x, summaryArea.y + 210);
    ctx.fillText(`Leitura->soltar: ${forensic.avgReadToRelease.toFixed(2)}px`, summaryArea.x + 360, summaryArea.y + 210);
    ctx.fillText(`Soltar->assentar: ${forensic.avgReleaseToLanding.toFixed(2)}px`, summaryArea.x + 760, summaryArea.y + 210);
    ctx.fillText(`Lag cmd/queda: ${forensic.avgCommandLagMs.toFixed(2)}ms / ${forensic.avgFlightLagMs.toFixed(1)}ms`, summaryArea.x + 1160, summaryArea.y + 210);
    ctx.fillText(`Ljung-Box Q: ${forensic.ljungBoxQ.toFixed(1)} | lags: ${forensic.ljungBoxLags}`, summaryArea.x, summaryArea.y + 254);
    ctx.fillText(`Regimes T/F/Q/M: ${forensic.phaseCounts.trigger}/${forensic.phaseCounts.frame}/${forensic.phaseCounts.landing}/${forensic.phaseCounts.mixed}`, summaryArea.x + 500, summaryArea.y + 254);
    ctx.fillText(`Troca de lado/regime: ${(forensic.flipRate * 100).toFixed(0)}% / ${forensic.phaseSwitches}`, summaryArea.x + 1160, summaryArea.y + 254);
    ctx.fillText(`Sessoes salvas: ${autoTraceSessions.length} | pontos totais: ${autoTrace.length + autoTraceSessions.reduce((sum, session) => sum + session.points.length, 0)}`, summaryArea.x, summaryArea.y + 298);
    ctx.fillText(`Escalas: erro ±${maxAbsError.toFixed(1)}px | stage ±${maxAbsStage.toFixed(1)}px | frame ±${maxAbsFrame.toFixed(2)}ms`, summaryArea.x + 760, summaryArea.y + 298);
    ctx.fillText(`Trigger->soltar perf lag: ${forensic.avgCommandLagPerfMs.toFixed(3)}ms`, summaryArea.x, summaryArea.y + 386);
    ctx.fillText(`Gap medio de frame: ${forensic.avgTriggerReleaseFrameGap.toFixed(2)}`, summaryArea.x + 520, summaryArea.y + 386);
    ctx.fillText(`Mesmo frame: ${(forensic.releaseSameFrameRate * 100).toFixed(0)}%`, summaryArea.x + 980, summaryArea.y + 386);
    ctx.fillText(`Release distinto: ${(forensic.releaseDistinctRate * 100).toFixed(0)}%`, summaryArea.x + 1360, summaryArea.y + 386);

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png', 1.0);
    link.download = `torre-auto-cartaz-${stamp}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setNotice('Cartaz HQ baixado');
  }, [activeTraceStartedAt, autoGraph.avgFrame, autoGraph.avgLanding, autoGraph.avgTrigger, autoGraph.dominantSignal, autoTrace, autoTraceSessions, captureMode, firstDeviationStageLabel, forensic, forensicLjungPLabel, forensicOriginLabel, forensicTemporalLabel, setNotice, traceForView]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(AUTO_TRACE_STORAGE_KEY, JSON.stringify(autoTraceSessions));
    } catch {
      // Ignore storage write errors.
    }
  }, [autoTraceSessions]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const draft: AutoTraceDraft = {
        startedAt: autoTraceStartedAt,
        targetX: autoDropTargetX,
        points: autoTrace,
        captureMode,
        updatedAt: Date.now(),
      };
      window.localStorage.setItem(AUTO_TRACE_DRAFT_STORAGE_KEY, JSON.stringify(draft));
      window.localStorage.setItem(AUTO_CAPTURE_MODE_STORAGE_KEY, captureMode ? '1' : '0');
    } catch {
      // Ignore storage write errors.
    }
  }, [autoDropTargetX, autoTrace, autoTraceStartedAt, captureMode]);

  // Game Engine Refs
  const blocksRef = useRef<Block[]>([]);
  const currentBlockRef = useRef<{ x: number; y: number; color: string; angle: number } | null>(null);
  const cameraYRef = useRef(0);
  const targetCameraYRef = useRef(0);
  const towerRotationRef = useRef(0);
  const shakeRef = useRef(0);
  const requestRef = useRef<number>(null);

  const gameOverTriggeredRef = useRef(false);

  // --- Game Logic ---

  const spawnBlock = useCallback(() => {
    currentBlockRef.current = {
      x: 0,
      y: -200, // Relative to camera
      color: getRandomColor(),
      angle: 0
    };
  }, []);

  const initGame = useCallback(() => {
    const now = Date.now();
    const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
    const centerTargetX = (canvasRef.current?.width ?? viewportWidth) / 2;
    finalizeAutoTraceSession('reset');
    blocksRef.current = [];
    cameraYRef.current = 0;
    targetCameraYRef.current = 0;
    towerRotationRef.current = 0;
    gameOverTriggeredRef.current = false;
    setScore(0);
    setStability(100);
    setLastPrecision(null);
    setAutoDropEnabled(true);
    autoDropEnabledRef.current = true;
    setAutoDropTargetX(centerTargetX);
    autoDropTargetXRef.current = centerTargetX;
    setAutoTrace([]);
    autoTraceRef.current = [];
    setAutoTraceStartedAt(now);
    autoTraceStartedAtRef.current = now;
    tapTimestampsRef.current = [];
    lastAutoDropTimeRef.current = 0;
    prevSwingXRef.current = null;
    pendingAutoTelemetryRef.current = null;
    lastFrameTimeRef.current = null;
    frameDeltaMsRef.current = 16.7;
    frameBaselineMsRef.current = 16.7;
    frameDriftMsRef.current = 0;
    frameTickRef.current = 0;
    shakeRef.current = 0;
    setGameState('PLAYING');
    setShowTutorial(true);
    spawnBlock();
  }, [finalizeAutoTraceSession, spawnBlock]);

  const dropBlock = useCallback(() => {
    if (gameStateRef.current !== 'PLAYING' || !currentBlockRef.current) return;

    if (showTutorial) setShowTutorial(false);

    const canvas = canvasRef.current;
    if (!canvas) return;

    const swingX = Math.sin(currentBlockRef.current.angle) * SWING_AMPLITUDE;
    const dropX = canvas.width / 2 + swingX - BLOCK_SIZE / 2;
    const dropCenterX = dropX + BLOCK_SIZE / 2;
    const releaseTimestamp = Date.now();
    const releasePerfMs = performance.now();
    const releaseFrame = frameTickRef.current;
    const pending = pendingAutoTelemetryRef.current;
    if (pending) {
      pending.releaseTimestamp = releaseTimestamp;
      pending.releasePerfMs = releasePerfMs;
      pending.releaseFrame = releaseFrame;
      pending.releaseX = dropCenterX;
      pending.releaseError = dropCenterX - pending.targetX;
      pending.stageReadToRelease = pending.releaseError - pending.triggerError;
      pending.commandLagMs = releaseTimestamp - pending.triggerTimestamp;
      pending.commandLagPerfMs = releasePerfMs - pending.triggerPerfMs;
      pending.triggerReleaseFrameGap = releaseFrame - pending.triggerFrame;
    }
    
    // Calculate world Y based on screen Y (80) and current camera translation
    // to ensure the block starts exactly where the hook was visually.
    const worldYTranslate = cameraYRef.current + canvas.height * 0.4;
    const dropY = 80 - worldYTranslate; 

    const newBlock: Block = {
      x: dropX,
      y: dropY,
      width: BLOCK_SIZE,
      height: BLOCK_SIZE,
      color: currentBlockRef.current.color,
      rotation: 0,
      vx: 0,
      vy: 0,
      isSettled: false
    };

    blocksRef.current.push(newBlock);
    currentBlockRef.current = null;

    // Spawn next block
    const spawnDelay = captureModeRef.current ? CAPTURE_SPAWN_DELAY_MS : NORMAL_SPAWN_DELAY_MS;
    setTimeout(() => {
      if (gameStateRef.current === 'PLAYING') spawnBlock();
    }, spawnDelay);
  }, [spawnBlock]);

  const handleCanvasTap = useCallback((event: React.PointerEvent<HTMLCanvasElement>) => {
    const now = Date.now();
    tapTimestampsRef.current = tapTimestampsRef.current.filter((ts) => now - ts <= TAP_WINDOW_MS);
    tapTimestampsRef.current.push(now);

    const canvas = canvasRef.current;
    if (!canvas) return;

    if (autoDropEnabledRef.current) {
      if (tapTimestampsRef.current.length >= 2) {
        finalizeAutoTraceSession('manual_off');
        setAutoDropEnabled(false);
        setAutoDropTargetX(null);
        setAutoTraceStartedAt(null);
        tapTimestampsRef.current = [];
        prevSwingXRef.current = null;
        pendingAutoTelemetryRef.current = null;
      }
      return;
    }

    if (tapTimestampsRef.current.length >= 3) {
      const rect = canvas.getBoundingClientRect();
      const targetX = Math.min(Math.max(event.clientX - rect.left, 0), rect.width);
      setAutoDropEnabled(true);
      setAutoDropTargetX(targetX);
      setAutoTrace([]);
      autoTraceRef.current = [];
      setAutoTraceStartedAt(now);
      tapTimestampsRef.current = [];
      lastAutoDropTimeRef.current = 0;
      prevSwingXRef.current = null;
      pendingAutoTelemetryRef.current = null;
      return;
    }

    pendingAutoTelemetryRef.current = null;
    dropBlock();
  }, [dropBlock, finalizeAutoTraceSession]);

  useEffect(() => {
    if (gameState === 'GAME_OVER' && autoDropEnabledRef.current) {
      finalizeAutoTraceSession('game_over');
      setAutoDropEnabled(false);
      setAutoDropTargetX(null);
      setAutoTraceStartedAt(null);
      pendingAutoTelemetryRef.current = null;
    }
  }, [gameState, finalizeAutoTraceSession]);

  const calculateStability = useCallback(() => {
    if (blocksRef.current.length === 0) return 100;

    const settledBlocks = blocksRef.current.filter(b => b.isSettled);
    if (settledBlocks.length === 0) return 100;

    // Real-world physics check: 
    // For each block, check if the center of mass of all blocks above it 
    // falls within its horizontal bounds.
    let minStability = 100;

    for (let i = 0; i < settledBlocks.length; i++) {
      const baseBlock = settledBlocks[i];
      const baseLeft = baseBlock.x;
      const baseRight = baseBlock.x + baseBlock.width;
      
      let totalMassX = 0;
      let count = 0;
      
      // Calculate center of mass of all blocks from i+1 to top
      for (let j = i + 1; j < settledBlocks.length; j++) {
        totalMassX += settledBlocks[j].x + settledBlocks[j].width / 2;
        count++;
      }
      
      if (count > 0) {
        const centerOfMassX = totalMassX / count;
        const margin = baseBlock.width * 0.5;
        const distFromCenter = Math.abs(centerOfMassX - (baseBlock.x + baseBlock.width / 2));
        const blockStability = Math.max(0, 100 - (distFromCenter / margin) * 100);
        minStability = Math.min(minStability, blockStability);
      }
    }
    
    setStability(Math.round(minStability));
    return minStability;
  }, []);

  const update = useCallback((time: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (lastFrameTimeRef.current !== null) {
      const rawDelta = time - lastFrameTimeRef.current;
      const delta = Math.max(0, Math.min(rawDelta, 100));
      frameDeltaMsRef.current = delta;
      frameBaselineMsRef.current = frameBaselineMsRef.current * 0.92 + delta * 0.08;
      frameDriftMsRef.current = delta - frameBaselineMsRef.current;
    }
    lastFrameTimeRef.current = time;

    const currentState = gameStateRef.current;
    frameTickRef.current += 1;

    // Reset transform and clear at the start of every frame
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // If game over, we stop drawing to save resources.
    if (currentState === 'GAME_OVER') return;

    // Update Camera
    // Tower top is at -score * BLOCK_SIZE. We want to see it.
    // So cameraY should be score * BLOCK_SIZE (positive)
    if (currentState === 'PLAYING') {
      targetCameraYRef.current = scoreRef.current * BLOCK_SIZE;
    }
    cameraYRef.current += (targetCameraYRef.current - cameraYRef.current) * 0.05;

    // Apply Shake
    if (shakeRef.current > 0.1) {
      const sx = (Math.random() - 0.5) * shakeRef.current;
      const sy = (Math.random() - 0.5) * shakeRef.current;
      ctx.translate(sx, sy);
      shakeRef.current *= 0.8;
    } else {
      shakeRef.current = 0;
    }

    // Draw Background Gradient
    const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gradient.addColorStop(0, '#e0f2fe');
    gradient.addColorStop(1, '#f0f9ff');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Draw Clouds (Parallax)
    ctx.save();
    ctx.translate(0, cameraYRef.current * 0.2); 
    ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
    for (let i = 0; i < 20; i++) {
      const cloudX = (Math.sin(i * 1.5) * 500 + 500) % canvas.width;
      const cloudY = i * 300 - 2000;
      ctx.beginPath();
      ctx.arc(cloudX, cloudY, 40, 0, Math.PI * 2);
      ctx.arc(cloudX + 30, cloudY - 10, 30, 0, Math.PI * 2);
      ctx.arc(cloudX + 60, cloudY, 40, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    // Translate world so y=0 (base) is near bottom, and tower grows UP (negative y)
    // We want the top of the tower (at -cameraYRef) to be around 0.3 * height
    ctx.translate(0, cameraYRef.current + canvas.height * 0.4);

    // Draw Base
    ctx.fillStyle = '#475569';
    ctx.fillRect(canvas.width / 2 - BASE_WIDTH / 2, 0, BASE_WIDTH, 20);

    // Update and Draw Blocks
    blocksRef.current.forEach((block, index) => {
      if (!block.isSettled && currentState !== 'FALLING') {
        block.vy += GRAVITY;
        block.y += block.vy;

        // Collision detection
        if (block.vy > 0) {
          const prevBlockY = index === 0 ? 0 : blocksRef.current[index - 1].y;
          const prevBlockX = index === 0 ? canvas.width / 2 - BASE_WIDTH / 2 : blocksRef.current[index - 1].x;
          const prevBlockWidth = index === 0 ? BASE_WIDTH : blocksRef.current[index - 1].width;

          if (block.y + block.height >= prevBlockY) {
            const landedOn = block.x + block.width > prevBlockX && block.x < prevBlockX + prevBlockWidth;

            if (!landedOn) {
              block.x = Math.min(Math.max(block.x, prevBlockX), prevBlockX + prevBlockWidth - block.width);
            }

            block.y = prevBlockY - block.height;
            block.isSettled = true;
            block.vy = 0;
            setScore(prev => prev + 1);
            shakeRef.current = landedOn ? 5 : 7;

            const targetX = index === 0 ? canvas.width / 2 - block.width / 2 : blocksRef.current[index - 1].x;
            const diff = Math.abs(block.x - targetX);
            if (!landedOn) setLastPrecision('BAD');
            else if (diff < 3) setLastPrecision('PERFECT');
            else if (diff < 15) setLastPrecision('GOOD');
            else setLastPrecision('BAD');

            if ((autoDropEnabledRef.current && autoDropTargetXRef.current !== null) || pendingAutoTelemetryRef.current) {
              const blockCenterX = block.x + block.width / 2;
              const pending = pendingAutoTelemetryRef.current;
              const targetX = pending?.targetX ?? autoDropTargetXRef.current ?? blockCenterX;
              const error = blockCenterX - targetX;
              const timestamp = Date.now();
              const triggerError = pending?.triggerError ?? error;
              const releaseError = typeof pending?.releaseError === 'number' ? pending.releaseError : triggerError;
              const stageReadToRelease = typeof pending?.stageReadToRelease === 'number'
                ? pending.stageReadToRelease
                : releaseError - triggerError;
              const stageReleaseToLanding = error - releaseError;
              const commandLagMs = typeof pending?.commandLagMs === 'number'
                ? pending.commandLagMs
                : undefined;
              const commandLagPerfMs = typeof pending?.commandLagPerfMs === 'number'
                ? pending.commandLagPerfMs
                : undefined;
              const triggerReleaseFrameGap = typeof pending?.triggerReleaseFrameGap === 'number'
                ? pending.triggerReleaseFrameGap
                : (
                  typeof pending?.releaseFrame === 'number' && typeof pending?.triggerFrame === 'number'
                    ? pending.releaseFrame - pending.triggerFrame
                    : undefined
                );
              const flightLagMs = typeof pending?.releaseTimestamp === 'number'
                ? timestamp - pending.releaseTimestamp
                : undefined;
              const frameDeltaMs = pending?.frameDeltaMs ?? frameDeltaMsRef.current;
              const frameBaselineMs = pending?.frameBaselineMs ?? frameBaselineMsRef.current;
              const frameDriftMs = pending?.frameDriftMs ?? frameDriftMsRef.current;
              setAutoTrace((prev) => {
                const next: AutoTracePoint[] = [
                  ...prev,
                  {
                    drop: prev.length + 1,
                    error,
                    timestamp,
                    blockCenterX,
                    targetX,
                    triggerX: pending?.triggerX,
                    releaseX: pending?.releaseX,
                    triggerError,
                    releaseError,
                    stageReadToRelease,
                    stageReleaseToLanding,
                    landingShift: error - triggerError,
                    frameDeltaMs,
                    frameBaselineMs,
                    frameDriftMs,
                    triggerTimestamp: pending?.triggerTimestamp,
                    triggerPerfMs: pending?.triggerPerfMs,
                    triggerFrame: pending?.triggerFrame,
                    releaseTimestamp: pending?.releaseTimestamp,
                    releasePerfMs: pending?.releasePerfMs,
                    releaseFrame: pending?.releaseFrame,
                    commandLagMs,
                    commandLagPerfMs,
                    triggerReleaseFrameGap,
                    flightLagMs,
                    triggerMode: pending?.triggerMode ?? 'manual',
                  },
                ];
                autoTraceRef.current = next;
                return next;
              });
              pendingAutoTelemetryRef.current = null;
            }

            calculateStability();
          }
        }
      }

      // Draw Block
      ctx.save();
      
      ctx.translate(block.x + block.width / 2, block.y + block.height / 2);
      
      if (currentState === 'FALLING' || currentState === 'GAME_OVER') {
        if (block.isSettled) {
          // Start falling
          block.isSettled = false;
          const centerX = canvas.width / 2;
          const offset = (block.x + block.width / 2) - centerX;
          block.vx = offset * 0.1 + (Math.random() - 0.5) * 5;
          block.vy = -Math.random() * 5;
        }
        
        if (currentState === 'FALLING') {
          block.vy += GRAVITY;
          block.y += block.vy;
          block.x += block.vx;
          block.rotation += block.vx * 0.05;
        }
        
        ctx.rotate(block.rotation);
      } else {
         // Keep settled blocks perfectly aligned while building.
         ctx.rotate(0);
      }

      ctx.fillStyle = block.color;
      ctx.shadowBlur = 10;
      ctx.shadowColor = 'rgba(0,0,0,0.1)';
      
      const r = 8;
      ctx.beginPath();
      ctx.roundRect(-block.width / 2, -block.height / 2, block.width, block.height, r);
      ctx.fill();
      
      if (lastPrecision === 'PERFECT' && index === blocksRef.current.length - 1 && block.isSettled) {
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 4;
        ctx.stroke();
      }

      ctx.restore();
    });

    if (currentState === 'FALLING') {
      let anyVisible = false;
      if (blocksRef.current.length > 0) {
        blocksRef.current.forEach((b) => {
          const screenY = b.y + cameraYRef.current + canvas.height * 0.4;
          // Use a wider margin for visibility check
          if (screenY < canvas.height + 400 && screenY > -1000) {
            anyVisible = true;
          }
        });
      }

      // Pan camera down slightly to see the fall
      targetCameraYRef.current *= 0.95;

      if (!anyVisible && !gameOverTriggeredRef.current) {
        gameOverTriggeredRef.current = true;
        setGameState('GAME_OVER');
        shakeRef.current = 0;
        if (scoreRef.current > highScoreRef.current) {
          setHighScore(scoreRef.current);
        }
        return; 
      }
    }

    ctx.restore();

    // Draw Swinging Block
    if (currentState === 'PLAYING' && currentBlockRef.current) {
      const swingingBlock = currentBlockRef.current;
      const captureSwingBoost = captureModeRef.current ? CAPTURE_SWING_MULTIPLIER : 1;
      const speedMultiplier = (1 + Math.floor(scoreRef.current / 10) * 0.2) * captureSwingBoost;
      swingingBlock.angle += SWING_SPEED * speedMultiplier;
      
      const swingX = Math.sin(swingingBlock.angle) * SWING_AMPLITUDE;
      const x = canvas.width / 2 + swingX;
      const y = 80; // Relative to screen top

      let autoDroppedThisFrame = false;
      if (autoDropEnabledRef.current && autoDropTargetXRef.current !== null) {
        const targetX = autoDropTargetXRef.current;
        const prevX = prevSwingXRef.current;
        const crossedTarget = prevX !== null && (prevX - targetX) * (x - targetX) <= 0;
        const nearTarget = Math.abs(x - targetX) <= AUTO_TARGET_TOLERANCE;
        const now = Date.now();
        const nowPerf = performance.now();
        const autoCooldownMs = captureModeRef.current ? CAPTURE_AUTO_DROP_COOLDOWN_MS : AUTO_DROP_COOLDOWN_MS;

        if ((crossedTarget || nearTarget) && now - lastAutoDropTimeRef.current > autoCooldownMs) {
          lastAutoDropTimeRef.current = now;
          pendingAutoTelemetryRef.current = {
            targetX,
            triggerX: x,
            triggerError: x - targetX,
            frameDeltaMs: frameDeltaMsRef.current,
            frameBaselineMs: frameBaselineMsRef.current,
            frameDriftMs: frameDriftMsRef.current,
            triggerTimestamp: now,
            triggerPerfMs: nowPerf,
            triggerFrame: frameTickRef.current,
            triggerMode: crossedTarget ? 'crossed' : 'near',
          };
          dropBlock();
          autoDroppedThisFrame = true;
        }
        prevSwingXRef.current = x;
      } else {
        prevSwingXRef.current = null;
      }

      if (autoDroppedThisFrame || !currentBlockRef.current) {
        return;
      }

      // Guide line for tutorial
      if (showTutorial) {
        ctx.setLineDash([5, 5]);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.15)';
        ctx.beginPath();
        ctx.moveTo(x, y + BLOCK_SIZE);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Draw Rope
      ctx.beginPath();
      ctx.moveTo(canvas.width / 2, -100);
      ctx.lineTo(x, y);
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.stroke();
      ctx.setLineDash([]);

      // Draw Hook
      ctx.fillStyle = '#475569';
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();

      // Draw Block
      ctx.save();
      ctx.translate(x, y);
      ctx.fillStyle = swingingBlock.color;
      ctx.shadowBlur = 20;
      ctx.shadowColor = 'rgba(0,0,0,0.15)';
      const r = 8;
      ctx.beginPath();
      ctx.roundRect(-BLOCK_SIZE / 2, 0, BLOCK_SIZE, BLOCK_SIZE, r);
      ctx.fill();
      ctx.restore();
    }
  }, [calculateStability, dropBlock, showTutorial]);

  const updateRef = useRef(update);
  useEffect(() => {
    updateRef.current = update;
  }, [update]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const viewport = window.visualViewport;

    const handleResize = () => {
      const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      canvas.width = Math.floor(viewportWidth);
      canvas.height = Math.floor(viewportHeight);
    };

    window.addEventListener('resize', handleResize);
    viewport?.addEventListener('resize', handleResize);
    handleResize();

    let frameId: number;
    const loop = (time: number) => {
      updateRef.current(time);
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener('resize', handleResize);
      viewport?.removeEventListener('resize', handleResize);
      cancelAnimationFrame(frameId);
    };
  }, []);

  // --- Render ---

  return (
    <div className="relative w-full h-[100dvh] overflow-hidden bg-sky-50 font-sans select-none touch-none">
      <canvas
        ref={canvasRef}
        onPointerDown={handleCanvasTap}
        className="block w-full h-full cursor-pointer"
      />

      {/* HUD */}
      <div className="absolute top-0 left-0 w-full p-4 sm:p-6 flex justify-between items-start pointer-events-none">
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={handleBackToHub}
            className="pointer-events-auto w-fit px-3 py-1 rounded-full bg-white/85 border border-white/80 text-[11px] font-black uppercase tracking-wide text-slate-700 hover:bg-white transition-colors"
          >
            Voltar
          </button>
          <div className="text-slate-500 text-xs font-bold uppercase tracking-widest">Blocos</div>
          <div className="text-3xl sm:text-4xl font-black text-slate-800 tabular-nums">{score}</div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="bg-white/80 backdrop-blur-md px-3 py-1.5 sm:px-4 sm:py-2 rounded-2xl shadow-sm border border-white/20 flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-bold text-slate-700">{highScore}</span>
          </div>
          
          <div className="w-24 sm:w-32 h-2 bg-slate-200 rounded-full overflow-hidden">
            <motion.div 
              className={`h-full ${stability > 60 ? 'bg-emerald-500' : stability > 30 ? 'bg-amber-500' : 'bg-rose-500'}`}
              initial={{ width: '100%' }}
              animate={{ width: `${stability}%` }}
            />
          </div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Estabilidade</div>
          {autoDropEnabled && (
            <div className="px-2.5 py-1 rounded-full bg-indigo-500/15 border border-indigo-400/30 text-[10px] font-black uppercase tracking-wider text-indigo-700">
              Auto ligado
            </div>
          )}
          <button
            type="button"
            onClick={() => setCaptureMode((prev) => !prev)}
            className={`pointer-events-auto px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border transition-colors ${
              captureMode
                ? 'bg-rose-500/15 border-rose-400/40 text-rose-700 hover:bg-rose-500/25'
                : 'bg-slate-500/10 border-slate-400/35 text-slate-700 hover:bg-slate-500/20'
            }`}
          >
            {captureMode ? 'Captura ON' : 'Captura OFF'}
          </button>
          <div className="text-[9px] font-bold text-slate-500 uppercase tracking-wide">
            spawn {currentSpawnDelay}ms | cooldown {currentAutoCooldown}ms
          </div>
        </div>
      </div>

      {showAutoPanel && (
        <div className="absolute left-3 bottom-4 z-[80] pointer-events-none">
          <div className="w-[268px] max-h-[72dvh] overflow-y-auto overscroll-contain rounded-2xl border border-indigo-300/50 bg-white/88 backdrop-blur-md shadow-xl p-3 pointer-events-auto">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-700">
                {autoDropEnabled ? 'Auto Ligado' : autoTrace.length > 0 ? 'Ultima Captura' : 'Sessao Salva'}
              </p>
              <p className="text-[10px] font-bold text-slate-500">
                {traceForView.length} blocos
              </p>
            </div>

            <svg width={autoGraph.width} height={autoGraph.height} className="block rounded-lg bg-slate-950/90">
              <line
                x1="0"
                y1={autoGraph.centerY}
                x2={autoGraph.width}
                y2={autoGraph.centerY}
                stroke="rgba(255,255,255,0.25)"
                strokeWidth="1"
                strokeDasharray="4 4"
              />
              {autoGraph.path && (
                <path
                  d={autoGraph.path}
                  fill="none"
                  stroke="#67e8f9"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
              {autoGraph.triggerPath && (
                <path
                  d={autoGraph.triggerPath}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="5 4"
                />
              )}
              {autoGraph.framePath && (
                <path
                  d={autoGraph.framePath}
                  fill="none"
                  stroke="#f472b6"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray="2 5"
                />
              )}
              {autoGraph.points.map((point, index) => (
                <circle
                  key={index}
                  cx={point.x}
                  cy={point.y}
                  r="1.8"
                  fill="#22d3ee"
                />
              ))}
            </svg>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] font-extrabold uppercase tracking-wide">
              <span className="text-cyan-500">Final</span>
              <span className="text-amber-500">Disparo</span>
              <span className="text-pink-500">Frame</span>
              <span className="text-slate-500">Dominante: {dominantSignalLabel}</span>
              <span className="text-slate-500">{captureModeLabel}</span>
            </div>

            <div className="mt-2 text-[10px] font-bold">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Escala ±{autoGraph.maxAbsError.toFixed(1)}px</span>
                <span className="text-slate-700">
                  Desvio atual {autoGraph.latest ? `${autoGraph.latest.error.toFixed(1)}px` : '--'}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between text-slate-600">
                <span>Disparo: {latestTriggerValue !== null ? `${latestTriggerValue.toFixed(1)}px` : '--'}</span>
                <span>Frame: {latestFrameDriftValue !== null ? `${latestFrameDriftValue.toFixed(2)}ms` : '--'}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-slate-600">
                <span>Media disparo: {autoGraph.avgTrigger.toFixed(1)}px</span>
                <span>Media frame: {autoGraph.avgFrame.toFixed(2)}ms</span>
              </div>
              <div className="mt-1 text-slate-600">
                Inicio: {activeTraceStartedAt ? formatPreciseTimestamp(activeTraceStartedAt) : '--'}
              </div>
              <div className="text-slate-600">
                Ultimo ponto: {autoGraph.latest ? formatPreciseTimestamp(autoGraph.latest.timestamp) : '--'}
              </div>
            </div>

            <div className="mt-2.5">
              <div className="flex items-center justify-between text-[9px] font-extrabold uppercase tracking-wide text-slate-600">
                <span>Autocorrelacao</span>
                <span>
                  lag {forensic.dominantLag || '--'} | r {forensic.dominantLagCorr.toFixed(2)}
                </span>
              </div>
              <svg width={forensic.width} height={forensic.height} className="mt-1 block rounded-lg bg-slate-950/90">
                <line
                  x1="0"
                  y1={forensic.centerY}
                  x2={forensic.width}
                  y2={forensic.centerY}
                  stroke="rgba(255,255,255,0.24)"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                />
                {forensic.autoPath && (
                  <path
                    d={forensic.autoPath}
                    fill="none"
                    stroke="#34d399"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
              </svg>
            </div>

            <div className="mt-2.5">
              <div className="flex items-center justify-between text-[9px] font-extrabold uppercase tracking-wide text-slate-600">
                <span>Espectro</span>
                <span>
                  periodo {forensic.peakPeriodDrops > 0 ? `${forensic.peakPeriodDrops.toFixed(1)} drops` : '--'}
                </span>
              </div>
              <svg width={forensic.width} height={forensic.height} className="mt-1 block rounded-lg bg-slate-950/90">
                <line
                  x1="0"
                  y1={forensic.baseY}
                  x2={forensic.width}
                  y2={forensic.baseY}
                  stroke="rgba(255,255,255,0.2)"
                  strokeWidth="1"
                />
                {forensic.spectrumBars.map((bar, index) => (
                  <rect
                    key={index}
                    x={bar.x}
                    y={bar.y}
                    width={bar.w}
                    height={Math.max(0.6, bar.h)}
                    fill="#38bdf8"
                    opacity={0.85}
                  />
                ))}
              </svg>
            </div>

            <div className="mt-2 text-[9px] font-extrabold uppercase tracking-wide text-slate-600 space-y-1">
              <div className="flex items-center justify-between">
                <span>Hipotese origem</span>
                <span>{forensicOriginLabel}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Score heuristico</span>
                <span>{forensicScorePct}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Estrutura temporal</span>
                <span>{forensicTemporalLabel}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Ljung-box p</span>
                <span>{forensicLjungPLabel}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Corr erro/disparo</span>
                <span>{forensic.corrTrigger.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Corr erro/soltar</span>
                <span>{forensic.corrRelease.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Corr erro/frame</span>
                <span>{forensic.corrFrame.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Corr erro/queda</span>
                <span>{forensic.corrLanding.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Troca de lado</span>
                <span>{(forensic.flipRate * 100).toFixed(0)}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Suporte janela</span>
                <span>{(forensic.originSupportRatio * 100).toFixed(0)}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Troca de regime</span>
                <span>{forensic.phaseSwitches}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Score T/F/Q</span>
                <span>{(forensic.scoreTrigger * 100).toFixed(0)} / {(forensic.scoreFrame * 100).toFixed(0)} / {(forensic.scoreLanding * 100).toFixed(0)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Etapa inicial</span>
                <span>{firstDeviationStageLabel}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>L-S / S-A</span>
                <span>{forensic.avgReadToRelease.toFixed(1)} / {forensic.avgReleaseToLanding.toFixed(1)} px</span>
              </div>
              <div className="flex items-center justify-between">
                <span>T-S perf lag</span>
                <span>{forensic.avgCommandLagPerfMs.toFixed(3)}ms</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Gap frame T-S</span>
                <span>{forensic.avgTriggerReleaseFrameGap.toFixed(2)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Mesmo frame</span>
                <span>{(forensic.releaseSameFrameRate * 100).toFixed(0)}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Release distinto</span>
                <span>{(forensic.releaseDistinctRate * 100).toFixed(0)}%</span>
              </div>
            </div>

            <div className="mt-2.5">
              <div className="flex items-center justify-between text-[9px] font-extrabold uppercase tracking-wide text-slate-600">
                <span>Lag Scanner</span>
                <span>
                  T {forensic.lagBestTrigger}/{forensic.lagBestTriggerCorr.toFixed(2)} | F {forensic.lagBestFrame}/{forensic.lagBestFrameCorr.toFixed(2)} | Q {forensic.lagBestLanding}/{forensic.lagBestLandingCorr.toFixed(2)}
                </span>
              </div>
              <svg width={forensic.width} height={forensic.height} className="mt-1 block rounded-lg bg-slate-950/90">
                <line
                  x1="0"
                  y1={forensic.centerY}
                  x2={forensic.width}
                  y2={forensic.centerY}
                  stroke="rgba(255,255,255,0.24)"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                />
                {forensic.lagPathTrigger && (
                  <path
                    d={forensic.lagPathTrigger}
                    fill="none"
                    stroke="#f59e0b"
                    strokeWidth="1.65"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                {forensic.lagPathFrame && (
                  <path
                    d={forensic.lagPathFrame}
                    fill="none"
                    stroke="#f472b6"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray="4 4"
                  />
                )}
                {forensic.lagPathLanding && (
                  <path
                    d={forensic.lagPathLanding}
                    fill="none"
                    stroke="#34d399"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray="2 4"
                  />
                )}
              </svg>
            </div>

            <div className="mt-2.5">
              <div className="flex items-center justify-between text-[9px] font-extrabold uppercase tracking-wide text-slate-600">
                <span>Mapa de Regime</span>
                <span>
                  T {forensic.phaseCounts.trigger} | F {forensic.phaseCounts.frame} | Q {forensic.phaseCounts.landing}
                </span>
              </div>
              <svg width={forensic.width} height="22" className="mt-1 block rounded-lg bg-slate-950/90">
                <rect x="0" y="0" width={forensic.width} height="22" fill="rgba(15,23,42,0.95)" />
                {forensic.phaseBars.map((bar, index) => (
                  <rect
                    key={index}
                    x={bar.x}
                    y="3"
                    width={bar.w}
                    height="16"
                    fill={bar.color}
                    rx="2"
                  />
                ))}
              </svg>
              <div className="mt-1 flex items-center justify-between text-[8px] font-extrabold uppercase tracking-wide text-slate-500">
                <span className="text-amber-500">Trigger</span>
                <span className="text-pink-500">Frame</span>
                <span className="text-emerald-500">Queda</span>
                <span className="text-slate-500">Misto {forensic.phaseCounts.mixed}</span>
              </div>
            </div>

            {forensic.topEvents.length > 0 && (
              <div className="mt-2.5 text-[8px] font-extrabold uppercase tracking-wide text-slate-600">
                <div className="mb-1">Top Eventos</div>
                <div className="space-y-1">
                  {forensic.topEvents.slice(0, 3).map((event, index) => (
                    <div key={index} className="rounded-md bg-slate-100/90 border border-slate-200 px-1.5 py-1 flex items-center justify-between">
                      <span>#{event.drop} {event.side} {formatPreciseTimestamp(event.timestamp).split(' ')[1] ?? formatPreciseTimestamp(event.timestamp)}</span>
                      <span>s {event.score.toFixed(2)} | e {event.error.toFixed(1)}px</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-3 grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={handleCopyJson}
                className="py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-indigo-100 text-indigo-700 border border-indigo-200 hover:bg-indigo-200 transition-colors"
              >
                Copiar
              </button>
              <button
                type="button"
                onClick={handleDownloadJson}
                className="py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-cyan-100 text-cyan-700 border border-cyan-200 hover:bg-cyan-200 transition-colors"
              >
                JSON
              </button>
              <button
                type="button"
                onClick={handleDownloadPoster}
                className="py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-700 border border-emerald-200 hover:bg-emerald-200 transition-colors"
              >
                Cartaz
              </button>
              <button
                type="button"
                onClick={() => setLiveLabOpen(true)}
                className="py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider bg-slate-200 text-slate-800 border border-slate-300 hover:bg-slate-300 transition-colors"
              >
                Ao Vivo
              </button>
            </div>

            {autoTraceNotice && (
              <p className="mt-2 text-[10px] font-bold text-indigo-700">{autoTraceNotice}</p>
            )}
            {lastStoredSession && (
              <p className="mt-1 text-[9px] font-semibold text-slate-500">
                Ultima sessao salva: {formatPreciseTimestamp(lastStoredSession.endedAt)} | {lastStoredSession.captureMode ? 'captura' : 'normal'}
              </p>
            )}
          </div>
        </div>
      )}

      {liveLabOpen && showAutoPanel && (
        <div
          className={`absolute inset-0 z-[88] pointer-events-auto ${
            liveLabGlassMode
              ? 'bg-slate-900/20 backdrop-blur-[1px]'
              : 'bg-slate-950/88 backdrop-blur-md'
          }`}
        >
          <div className="absolute top-3 right-3 flex items-center gap-2 z-[5]">
            <button
              type="button"
              onClick={() => setLiveLabGlassMode((prev) => !prev)}
              className={`px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wider border ${
                liveLabGlassMode
                  ? 'bg-cyan-200/80 text-cyan-900 border-cyan-300'
                  : 'bg-white/90 text-slate-900 border-white/70'
              }`}
            >
              {liveLabGlassMode ? 'Modo Normal' : 'Modo Vidro'}
            </button>
            <button
              type="button"
              onClick={() => setLiveLabOpen(false)}
              className="px-3 py-1.5 rounded-xl text-[11px] font-black uppercase tracking-wider bg-rose-500/90 text-white border border-rose-300/60"
            >
              Fechar
            </button>
          </div>

          <div className="absolute inset-0 pt-16 pb-4 px-3 sm:px-6 overflow-auto">
            <div
              className={`mx-auto max-w-[1400px] rounded-3xl border p-4 sm:p-6 ${
                liveLabGlassMode
                  ? 'bg-white/22 border-white/35 shadow-2xl'
                  : 'bg-slate-900/82 border-slate-700/70 shadow-2xl'
              }`}
            >
              <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
                <div>
                  <h3 className={`text-2xl sm:text-3xl font-black tracking-tight ${liveLabGlassMode ? 'text-white' : 'text-slate-100'}`}>
                    LAB AO VIVO - SINAL
                  </h3>
                  <p className={`text-xs sm:text-sm font-bold ${liveLabGlassMode ? 'text-white/80' : 'text-slate-300'}`}>
                    Hipotese origem: {forensicOriginLabel} | Score heuristico {forensicScorePct}% | Estrutura {forensicTemporalLabel} | Pontos {traceForView.length}
                  </p>
                </div>
                <div className={`text-[10px] font-black uppercase tracking-widest ${liveLabGlassMode ? 'text-white/75' : 'text-slate-400'}`}>
                  Spawn {currentSpawnDelay}ms | Cooldown {currentAutoCooldown}ms
                </div>
              </div>

              <div className={`rounded-2xl p-2 sm:p-3 border ${liveLabGlassMode ? 'bg-white/20 border-white/30' : 'bg-slate-950/80 border-slate-800/80'}`}>
                <svg viewBox={`0 0 ${autoGraph.width} ${autoGraph.height}`} className="w-full h-[34dvh] sm:h-[40dvh] block rounded-xl">
                  <rect x="0" y="0" width={autoGraph.width} height={autoGraph.height} fill="rgba(2,6,23,0.86)" />
                  <line
                    x1="0"
                    y1={autoGraph.centerY}
                    x2={autoGraph.width}
                    y2={autoGraph.centerY}
                    stroke="rgba(255,255,255,0.22)"
                    strokeWidth="1"
                    strokeDasharray="4 4"
                  />
                  {autoGraph.path && (
                    <path d={autoGraph.path} fill="none" stroke="#22d3ee" strokeWidth="2.35" strokeLinecap="round" strokeLinejoin="round" />
                  )}
                  {autoGraph.triggerPath && (
                    <path d={autoGraph.triggerPath} fill="none" stroke="#f59e0b" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="5 4" />
                  )}
                  {autoGraph.framePath && (
                    <path d={autoGraph.framePath} fill="none" stroke="#f472b6" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2 5" />
                  )}
                  {autoGraph.points.map((point, index) => (
                    <circle key={index} cx={point.x} cy={point.y} r="1.8" fill="#22d3ee" />
                  ))}
                </svg>
              </div>

              <div className="mt-4 grid grid-cols-1 lg:grid-cols-3 gap-3">
                <div className={`rounded-2xl p-2 border ${liveLabGlassMode ? 'bg-white/20 border-white/30' : 'bg-slate-950/80 border-slate-800/80'}`}>
                  <div className={`text-[10px] font-black uppercase tracking-wider mb-1 ${liveLabGlassMode ? 'text-white/85' : 'text-slate-300'}`}>
                    Autocorrelação
                  </div>
                  <svg viewBox={`0 0 ${forensic.width} ${forensic.height}`} className="w-full h-[16dvh] min-h-[120px] block rounded-lg">
                    <rect x="0" y="0" width={forensic.width} height={forensic.height} fill="rgba(2,6,23,0.86)" />
                    <line x1="0" y1={forensic.centerY} x2={forensic.width} y2={forensic.centerY} stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="4 4" />
                    {forensic.autoPath && (
                      <path d={forensic.autoPath} fill="none" stroke="#34d399" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                    )}
                  </svg>
                </div>

                <div className={`rounded-2xl p-2 border ${liveLabGlassMode ? 'bg-white/20 border-white/30' : 'bg-slate-950/80 border-slate-800/80'}`}>
                  <div className={`text-[10px] font-black uppercase tracking-wider mb-1 ${liveLabGlassMode ? 'text-white/85' : 'text-slate-300'}`}>
                    Espectro
                  </div>
                  <svg viewBox={`0 0 ${forensic.width} ${forensic.height}`} className="w-full h-[16dvh] min-h-[120px] block rounded-lg">
                    <rect x="0" y="0" width={forensic.width} height={forensic.height} fill="rgba(2,6,23,0.86)" />
                    <line x1="0" y1={forensic.baseY} x2={forensic.width} y2={forensic.baseY} stroke="rgba(255,255,255,0.2)" strokeWidth="1" />
                    {forensic.spectrumValues.map((value, index) => {
                      const step = forensic.spectrumValues.length > 0 ? forensic.width / forensic.spectrumValues.length : 0;
                      const barW = Math.max(1.2, step * 0.72);
                      const h = (value / maxSpectrumValue) * (forensic.height - 14);
                      const x = index * step + (step - barW) / 2;
                      const y = forensic.baseY - h;
                      return <rect key={index} x={x} y={y} width={barW} height={Math.max(0.6, h)} fill="#38bdf8" opacity="0.9" />;
                    })}
                  </svg>
                </div>

                <div className={`rounded-2xl p-2 border ${liveLabGlassMode ? 'bg-white/20 border-white/30' : 'bg-slate-950/80 border-slate-800/80'}`}>
                  <div className={`text-[10px] font-black uppercase tracking-wider mb-1 ${liveLabGlassMode ? 'text-white/85' : 'text-slate-300'}`}>
                    Lag Scanner
                  </div>
                  <svg viewBox={`0 0 ${forensic.width} ${forensic.height}`} className="w-full h-[16dvh] min-h-[120px] block rounded-lg">
                    <rect x="0" y="0" width={forensic.width} height={forensic.height} fill="rgba(2,6,23,0.86)" />
                    <line x1="0" y1={forensic.centerY} x2={forensic.width} y2={forensic.centerY} stroke="rgba(255,255,255,0.2)" strokeWidth="1" strokeDasharray="4 4" />
                    {forensic.lagPathTrigger && (
                      <path d={forensic.lagPathTrigger} fill="none" stroke="#f59e0b" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                    )}
                    {forensic.lagPathFrame && (
                      <path d={forensic.lagPathFrame} fill="none" stroke="#f472b6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 4" />
                    )}
                    {forensic.lagPathLanding && (
                      <path d={forensic.lagPathLanding} fill="none" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="2 4" />
                    )}
                  </svg>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className={`rounded-2xl p-2 border ${liveLabGlassMode ? 'bg-white/20 border-white/30' : 'bg-slate-950/80 border-slate-800/80'}`}>
                  <div className={`text-[10px] font-black uppercase tracking-wider mb-1 ${liveLabGlassMode ? 'text-white/85' : 'text-slate-300'}`}>
                    Mapa de Regime
                  </div>
                  <svg viewBox={`0 0 ${forensic.width} 24`} className="w-full h-[40px] block rounded-lg">
                    <rect x="0" y="0" width={forensic.width} height="24" fill="rgba(2,6,23,0.86)" />
                    {forensic.phaseSegments.map((segment, index) => {
                      const x = segment.startRatio * forensic.width;
                      const w = Math.max(2, (segment.endRatio - segment.startRatio) * forensic.width);
                      const color = segment.phase === 'trigger'
                        ? '#f59e0b'
                        : segment.phase === 'frame'
                          ? '#f472b6'
                          : segment.phase === 'landing'
                            ? '#34d399'
                            : '#94a3b8';
                      return <rect key={index} x={x} y="4" width={w} height="16" rx="2" fill={color} />;
                    })}
                  </svg>
                  <div className={`mt-1 text-[10px] font-black uppercase tracking-wide flex items-center justify-between ${liveLabGlassMode ? 'text-white/80' : 'text-slate-300'}`}>
                    <span>T {forensic.phaseCounts.trigger}</span>
                    <span>F {forensic.phaseCounts.frame}</span>
                    <span>Q {forensic.phaseCounts.landing}</span>
                    <span>M {forensic.phaseCounts.mixed}</span>
                  </div>
                  <div className={`mt-1 text-[10px] font-black uppercase tracking-wide flex items-center justify-between ${liveLabGlassMode ? 'text-white/80' : 'text-slate-300'}`}>
                    <span>Suporte janela</span>
                    <span>{(forensic.originSupportRatio * 100).toFixed(0)}%</span>
                  </div>
                  <div className={`mt-1 text-[10px] font-black uppercase tracking-wide flex items-center justify-between ${liveLabGlassMode ? 'text-white/80' : 'text-slate-300'}`}>
                    <span>Troca regime</span>
                    <span>{forensic.phaseSwitches}</span>
                  </div>
                  <div className={`mt-1 text-[10px] font-black uppercase tracking-wide flex items-center justify-between ${liveLabGlassMode ? 'text-white/80' : 'text-slate-300'}`}>
                    <span>Ljung-box p</span>
                    <span>{forensicLjungPLabel}</span>
                  </div>
                  <div className={`mt-1 text-[10px] font-black uppercase tracking-wide flex items-center justify-between ${liveLabGlassMode ? 'text-white/80' : 'text-slate-300'}`}>
                    <span>Etapa inicial</span>
                    <span>{firstDeviationStageLabel}</span>
                  </div>
                  <div className={`mt-1 text-[10px] font-black uppercase tracking-wide flex items-center justify-between ${liveLabGlassMode ? 'text-white/80' : 'text-slate-300'}`}>
                    <span>L-S / S-A</span>
                    <span>{forensic.avgReadToRelease.toFixed(1)} / {forensic.avgReleaseToLanding.toFixed(1)}px</span>
                  </div>
                  <div className={`mt-1 text-[10px] font-black uppercase tracking-wide flex items-center justify-between ${liveLabGlassMode ? 'text-white/80' : 'text-slate-300'}`}>
                    <span>T-S perf lag</span>
                    <span>{forensic.avgCommandLagPerfMs.toFixed(3)}ms</span>
                  </div>
                  <div className={`mt-1 text-[10px] font-black uppercase tracking-wide flex items-center justify-between ${liveLabGlassMode ? 'text-white/80' : 'text-slate-300'}`}>
                    <span>Gap frame T-S</span>
                    <span>{forensic.avgTriggerReleaseFrameGap.toFixed(2)}</span>
                  </div>
                  <div className={`mt-1 text-[10px] font-black uppercase tracking-wide flex items-center justify-between ${liveLabGlassMode ? 'text-white/80' : 'text-slate-300'}`}>
                    <span>Mesmo frame</span>
                    <span>{(forensic.releaseSameFrameRate * 100).toFixed(0)}%</span>
                  </div>
                  <div className={`mt-1 text-[10px] font-black uppercase tracking-wide flex items-center justify-between ${liveLabGlassMode ? 'text-white/80' : 'text-slate-300'}`}>
                    <span>Release distinto</span>
                    <span>{(forensic.releaseDistinctRate * 100).toFixed(0)}%</span>
                  </div>
                </div>

                <div className={`rounded-2xl p-2 border ${liveLabGlassMode ? 'bg-white/20 border-white/30' : 'bg-slate-950/80 border-slate-800/80'}`}>
                  <div className={`text-[10px] font-black uppercase tracking-wider mb-1 ${liveLabGlassMode ? 'text-white/85' : 'text-slate-300'}`}>
                    Top Eventos
                  </div>
                  <div className="space-y-1">
                    {forensic.topEvents.slice(0, 5).map((event, index) => (
                      <div
                        key={index}
                        className={`rounded-lg px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide flex items-center justify-between ${
                          liveLabGlassMode ? 'bg-white/20 text-white border border-white/20' : 'bg-slate-800/80 text-slate-100 border border-slate-700'
                        }`}
                      >
                        <span>#{event.drop} {event.side} {formatPreciseTimestamp(event.timestamp).split(' ')[1] ?? formatPreciseTimestamp(event.timestamp)}</span>
                        <span>s {event.score.toFixed(2)} | e {event.error.toFixed(1)}px</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Precision Feedback */}
      <AnimatePresence>
        {lastPrecision && gameState === 'PLAYING' && (
          <motion.div
            key={score}
            initial={{ opacity: 0, y: 20, scale: 0.5 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 1.5 }}
            className="absolute top-1/3 left-1/2 -translate-x-1/2 pointer-events-none"
          >
            <span className={`text-2xl font-black italic uppercase tracking-tighter ${
              lastPrecision === 'PERFECT' ? 'text-emerald-500' : 
              lastPrecision === 'GOOD' ? 'text-sky-500' : 'text-amber-500'
            }`}>
              {lastPrecision === 'PERFECT' ? 'PERFEITO' : lastPrecision === 'GOOD' ? 'BOM' : 'RUIM'}!
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Overlays */}
      {gameState === 'IDLE' && (
        <div className="absolute inset-0 bg-white/40 backdrop-blur-sm flex flex-col items-center justify-center p-8 text-center z-50">
          <motion.h1 
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="text-4xl sm:text-6xl font-black text-slate-800 mb-2 tracking-tighter"
          >
            EQUILÍBRIO<br/>DE TORRE
          </motion.h1>
          <p className="text-slate-500 mb-8 max-w-xs">
            Solte os blocos no momento perfeito para construir uma torre estável. Não deixe cair!
          </p>
          <button
            onClick={initGame}
            className="group relative px-7 py-3 sm:px-8 sm:py-4 bg-slate-800 text-white rounded-2xl font-bold text-lg sm:text-xl shadow-xl hover:bg-slate-700 transition-all active:scale-95 pointer-events-auto"
          >
            <div className="flex items-center gap-2">
              <Play className="w-6 h-6 fill-current" />
              INICIAR JOGO
            </div>
          </button>
          <p className="text-[11px] text-slate-500 mt-4 uppercase tracking-widest">
            3 toques: auto no ponto | 2 toques: desativar auto
          </p>
          <p className="text-[10px] text-slate-500 mt-2 uppercase tracking-wider">
            Captura {captureMode ? 'ON' : 'OFF'} no canto superior direito
          </p>
        </div>
      )}

      {gameState === 'GAME_OVER' && (
        <div className="absolute inset-0 bg-slate-900/90 backdrop-blur-xl flex flex-col items-center justify-center p-8 text-center text-white z-50">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white/10 p-8 sm:p-12 rounded-[2.2rem] sm:rounded-[3rem] border border-white/10 shadow-2xl max-w-sm w-full"
          >
            <div className="w-20 h-20 bg-rose-500 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-rose-500/40">
              <AlertTriangle className="w-10 h-10 text-white" />
            </div>
            
            <h2 className="text-3xl sm:text-4xl font-black mb-1 tracking-tighter uppercase">A Torre Caiu!</h2>
            <p className="text-white/50 text-sm font-bold uppercase tracking-widest mb-8">Fim de Jogo</p>
            
            <div className="grid grid-cols-2 gap-4 mb-10">
              <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                <div className="text-[10px] uppercase font-bold text-white/40 tracking-widest mb-1">Pontos</div>
                <div className="text-3xl font-black tabular-nums">{score}</div>
              </div>
              <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                <div className="text-[10px] uppercase font-bold text-white/40 tracking-widest mb-1">Melhor</div>
                <div className="text-3xl font-black tabular-nums">{highScore}</div>
              </div>
            </div>

            <button
              onClick={initGame}
              className="w-full py-5 bg-white text-slate-900 rounded-2xl font-black text-lg shadow-xl hover:bg-slate-100 transition-all active:scale-95 flex items-center justify-center gap-3 pointer-events-auto"
            >
              <RotateCcw className="w-6 h-6" />
              JOGAR NOVAMENTE
            </button>
          </motion.div>
        </div>
      )}

      {/* Controls Hint */}
      {gameState === 'PLAYING' && score === 0 && showTutorial && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute inset-0 pointer-events-none flex items-center justify-center"
        >
          <div className="relative w-full h-full">
            {/* Moving Hand Icon */}
            <motion.div
              animate={{
                x: `calc(50% + ${Math.sin(Date.now() * 0.003) * SWING_AMPLITUDE}px - 20px)`,
                y: '140px',
                scale: [1, 0.9, 1],
              }}
              transition={{
                scale: { repeat: Infinity, duration: 1 },
              }}
              className="absolute text-slate-800"
            >
              <div className="relative">
                <MousePointer2 className="w-12 h-12 drop-shadow-lg" />
                <motion.div
                  animate={{ scale: [1, 2], opacity: [0.5, 0] }}
                  transition={{ repeat: Infinity, duration: 1 }}
                  className="absolute top-0 left-0 w-12 h-12 bg-slate-400 rounded-full -z-10"
                />
              </div>
              <div className="mt-4 bg-white/90 backdrop-blur px-4 py-2 rounded-full shadow-lg border border-slate-200 whitespace-nowrap font-bold text-sm">
                TOQUE PARA SOLTAR!
              </div>
            </motion.div>
          </div>
        </motion.div>
      )}

      {gameState === 'PLAYING' && score === 0 && !showTutorial && (
        <motion.div 
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="absolute bottom-12 left-1/2 -translate-x-1/2 text-slate-400 font-bold text-xs sm:text-sm uppercase tracking-widest animate-pulse"
        >
          Toque para Soltar
        </motion.div>
      )}
    </div>
  );
}
