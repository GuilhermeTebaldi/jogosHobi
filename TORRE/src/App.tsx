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
}

interface AutoTraceSession {
  id: string;
  startedAt: number;
  endedAt: number;
  reason: 'manual_off' | 'reset' | 'game_over';
  targetX: number;
  points: AutoTracePoint[];
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
const AUTO_TARGET_TOLERANCE = 10;
const AUTO_TRACE_MAX_POINTS = 80;
const AUTO_TRACE_MAX_SESSIONS = 40;
const AUTO_TRACE_STORAGE_KEY = 'torre_auto_trace_sessions_v1';

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
      ))
      .slice(0, AUTO_TRACE_MAX_SESSIONS);
  } catch {
    return [];
  }
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
  const [autoDropEnabled, setAutoDropEnabled] = useState(false);
  const [autoDropTargetX, setAutoDropTargetX] = useState<number | null>(null);
  const [autoTrace, setAutoTrace] = useState<AutoTracePoint[]>([]);
  const [autoTraceStartedAt, setAutoTraceStartedAt] = useState<number | null>(null);
  const [autoTraceSessions, setAutoTraceSessions] = useState<AutoTraceSession[]>(() => loadAutoTraceSessions());
  const [autoTraceNotice, setAutoTraceNotice] = useState<string | null>(null);
  const autoDropEnabledRef = useRef(false);
  const autoDropTargetXRef = useRef<number | null>(null);
  const autoTraceRef = useRef<AutoTracePoint[]>([]);
  const autoTraceStartedAtRef = useRef<number | null>(null);
  const tapTimestampsRef = useRef<number[]>([]);
  const lastAutoDropTimeRef = useRef(0);
  const prevSwingXRef = useRef<number | null>(null);
  useEffect(() => { autoDropEnabledRef.current = autoDropEnabled; }, [autoDropEnabled]);
  useEffect(() => { autoDropTargetXRef.current = autoDropTargetX; }, [autoDropTargetX]);
  useEffect(() => { autoTraceRef.current = autoTrace; }, [autoTrace]);
  useEffect(() => { autoTraceStartedAtRef.current = autoTraceStartedAt; }, [autoTraceStartedAt]);

  const autoGraph = useMemo(() => {
    const width = 220;
    const height = 112;
    const pad = 10;
    const centerY = height / 2;
    const maxAbsError = Math.max(12, ...autoTrace.map((point) => Math.abs(point.error)));

    const points = autoTrace.map((point, index) => {
      const ratio = autoTrace.length <= 1 ? 1 : index / (autoTrace.length - 1);
      const x = pad + ratio * (width - pad * 2);
      const y = centerY - (point.error / maxAbsError) * (centerY - pad);
      return { x, y };
    });

    const path = points
      .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`)
      .join(' ');

    return {
      width,
      height,
      centerY,
      maxAbsError,
      path,
      points,
      latest: autoTrace.length > 0 ? autoTrace[autoTrace.length - 1] : null,
    };
  }, [autoTrace]);
  const showAutoPanel = autoDropEnabled || autoTrace.length > 0;
  const lastStoredSession = autoTraceSessions.length > 0 ? autoTraceSessions[0] : null;

  const finalizeAutoTraceSession = useCallback((reason: AutoTraceSession['reason']) => {
    const points = autoTraceRef.current;
    const startedAt = autoTraceStartedAtRef.current;
    const targetX = autoDropTargetXRef.current;

    if (!startedAt || !targetX || points.length === 0) {
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
    };

    setAutoTraceSessions((prev) => [session, ...prev].slice(0, AUTO_TRACE_MAX_SESSIONS));
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
    if (autoTrace.length === 0) {
      setNotice('Sem dados para baixar');
      return;
    }

    const payload = {
      exportedAt: Date.now(),
      exportedAtFormatted: formatPreciseTimestamp(Date.now()),
      startedAt: autoTraceStartedAt,
      startedAtFormatted: autoTraceStartedAt ? formatPreciseTimestamp(autoTraceStartedAt) : null,
      targetX: autoDropTargetX,
      points: autoTrace,
    };
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    downloadTextFile(`torre-auto-trace-${stamp}.json`, JSON.stringify(payload, null, 2));
    setNotice('JSON baixado');
  }, [autoTrace, autoTraceStartedAt, autoDropTargetX, downloadTextFile, setNotice]);

  const handleCopyJson = useCallback(async () => {
    if (autoTrace.length === 0) {
      setNotice('Sem dados para copiar');
      return;
    }

    const payload = {
      copiedAt: Date.now(),
      copiedAtFormatted: formatPreciseTimestamp(Date.now()),
      startedAt: autoTraceStartedAt,
      startedAtFormatted: autoTraceStartedAt ? formatPreciseTimestamp(autoTraceStartedAt) : null,
      targetX: autoDropTargetX,
      points: autoTrace,
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setNotice('Dados copiados');
    } catch {
      setNotice('Falha ao copiar');
    }
  }, [autoTrace, autoTraceStartedAt, autoDropTargetX, setNotice]);

  const handleDownloadPoster = useCallback(() => {
    if (autoTrace.length < 2) {
      setNotice('Dados insuficientes para cartaz');
      return;
    }

    const width = 1200;
    const height = 800;
    const chartLeft = 90;
    const chartTop = 170;
    const chartWidth = 1020;
    const chartHeight = 470;
    const centerY = chartTop + chartHeight / 2;
    const maxAbsError = Math.max(12, ...autoTrace.map((point) => Math.abs(point.error)));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setNotice('Falha ao gerar cartaz');
      return;
    }

    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#0f172a');
    gradient.addColorStop(1, '#1e293b');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '900 42px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillText('TORRE - AUTO TRACE', 90, 78);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 21px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillText(`Inicio: ${autoTraceStartedAt ? formatPreciseTimestamp(autoTraceStartedAt) : '--'}`, 90, 116);
    ctx.fillText(`Ultimo ponto: ${formatPreciseTimestamp(autoTrace[autoTrace.length - 1].timestamp)}`, 90, 144);

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(chartLeft, chartTop, chartWidth, chartHeight);

    ctx.beginPath();
    ctx.setLineDash([8, 8]);
    ctx.moveTo(chartLeft, centerY);
    ctx.lineTo(chartLeft + chartWidth, centerY);
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.35)';
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    autoTrace.forEach((point, index) => {
      const ratio = autoTrace.length <= 1 ? 1 : index / (autoTrace.length - 1);
      const x = chartLeft + ratio * chartWidth;
      const y = centerY - (point.error / maxAbsError) * (chartHeight / 2 - 18);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 3.5;
    ctx.stroke();

    ctx.fillStyle = '#22d3ee';
    autoTrace.forEach((point, index) => {
      const ratio = autoTrace.length <= 1 ? 1 : index / (autoTrace.length - 1);
      const x = chartLeft + ratio * chartWidth;
      const y = centerY - (point.error / maxAbsError) * (chartHeight / 2 - 18);
      ctx.beginPath();
      ctx.arc(x, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    });

    const latest = autoTrace[autoTrace.length - 1];
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '700 20px system-ui, -apple-system, Segoe UI, sans-serif';
    ctx.fillText(`Pontos: ${autoTrace.length}`, 90, 700);
    ctx.fillText(`Escala: ±${maxAbsError.toFixed(1)}px`, 300, 700);
    ctx.fillText(`Desvio atual: ${latest.error.toFixed(1)}px`, 560, 700);
    ctx.fillText(`Alvo X: ${latest.targetX.toFixed(1)}px`, 910, 700);

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `torre-auto-cartaz-${stamp}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setNotice('Cartaz baixado');
  }, [autoTrace, autoTraceStartedAt, setNotice]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(AUTO_TRACE_STORAGE_KEY, JSON.stringify(autoTraceSessions));
    } catch {
      // Ignore storage write errors.
    }
  }, [autoTraceSessions]);

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
    finalizeAutoTraceSession('reset');
    blocksRef.current = [];
    cameraYRef.current = 0;
    targetCameraYRef.current = 0;
    towerRotationRef.current = 0;
    gameOverTriggeredRef.current = false;
    setScore(0);
    setStability(100);
    setLastPrecision(null);
    setAutoDropEnabled(false);
    setAutoDropTargetX(null);
    setAutoTrace([]);
    autoTraceRef.current = [];
    setAutoTraceStartedAt(null);
    tapTimestampsRef.current = [];
    lastAutoDropTimeRef.current = 0;
    prevSwingXRef.current = null;
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
    setTimeout(() => {
      if (gameStateRef.current === 'PLAYING') spawnBlock();
    }, 800);
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
      return;
    }

    dropBlock();
  }, [dropBlock, finalizeAutoTraceSession]);

  useEffect(() => {
    if (gameState === 'GAME_OVER' && autoDropEnabledRef.current) {
      finalizeAutoTraceSession('game_over');
      setAutoDropEnabled(false);
      setAutoDropTargetX(null);
      setAutoTraceStartedAt(null);
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

    const currentState = gameStateRef.current;

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

            if (landedOn) {
              block.y = prevBlockY - block.height;
              block.isSettled = true;
              block.vy = 0;
              setScore(prev => prev + 1);
              shakeRef.current = 5; // Impact shake
              
              const targetX = index === 0 ? canvas.width / 2 - block.width / 2 : blocksRef.current[index - 1].x;
              const diff = Math.abs(block.x - targetX);
              if (diff < 3) setLastPrecision('PERFECT');
              else if (diff < 15) setLastPrecision('GOOD');
              else setLastPrecision('BAD');

              if (autoDropEnabledRef.current && autoDropTargetXRef.current !== null) {
                const blockCenterX = block.x + block.width / 2;
                const targetX = autoDropTargetXRef.current;
                const error = blockCenterX - targetX;
                const timestamp = Date.now();
                setAutoTrace((prev) => {
                  const next: AutoTracePoint[] = [
                    ...prev,
                    {
                      drop: prev.length + 1,
                      error,
                      timestamp,
                      blockCenterX,
                      targetX,
                    },
                  ];
                  autoTraceRef.current = next.slice(-AUTO_TRACE_MAX_POINTS);
                  return next.slice(-AUTO_TRACE_MAX_POINTS);
                });
              }

              const currentStability = calculateStability();
              if (currentStability <= 0) {
                setGameState('FALLING');
                shakeRef.current = 20; // Collapse shake
              }
            } else {
              setGameState('FALLING');
              shakeRef.current = 10; // Miss shake
            }
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
      const speedMultiplier = 1 + Math.floor(scoreRef.current / 10) * 0.2;
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

        if ((crossedTarget || nearTarget) && now - lastAutoDropTimeRef.current > AUTO_DROP_COOLDOWN_MS) {
          lastAutoDropTimeRef.current = now;
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
        </div>
      </div>

      {showAutoPanel && (
        <div className="absolute left-3 bottom-4 z-40 pointer-events-none">
          <div className="w-[250px] rounded-2xl border border-indigo-300/50 bg-white/88 backdrop-blur-md shadow-xl p-3 pointer-events-auto">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-black uppercase tracking-[0.2em] text-indigo-700">
                {autoDropEnabled ? 'Auto Ligado' : 'Ultima Captura'}
              </p>
              <p className="text-[10px] font-bold text-slate-500">
                {autoTrace.length} blocos
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

            <div className="mt-2 text-[10px] font-bold">
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Escala ±{autoGraph.maxAbsError.toFixed(1)}px</span>
                <span className="text-slate-700">
                  Desvio atual {autoGraph.latest ? `${autoGraph.latest.error.toFixed(1)}px` : '--'}
                </span>
              </div>
              <div className="mt-1 text-slate-600">
                Inicio: {autoTraceStartedAt ? formatPreciseTimestamp(autoTraceStartedAt) : '--'}
              </div>
              <div className="text-slate-600">
                Ultimo ponto: {autoGraph.latest ? formatPreciseTimestamp(autoGraph.latest.timestamp) : '--'}
              </div>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-1.5">
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
            </div>

            {autoTraceNotice && (
              <p className="mt-2 text-[10px] font-bold text-indigo-700">{autoTraceNotice}</p>
            )}
            {lastStoredSession && (
              <p className="mt-1 text-[9px] font-semibold text-slate-500">
                Ultima sessao salva: {formatPreciseTimestamp(lastStoredSession.endedAt)}
              </p>
            )}
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
