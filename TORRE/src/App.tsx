/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, RotateCcw, Play, AlertTriangle, MousePointer2, Bird as BirdLifeIcon } from 'lucide-react';

// --- Types & Constants ---

type GameState = 'IDLE' | 'PLAYING' | 'FALLING' | 'GAME_OVER';

interface BloodMark {
  x: number;
  y: number;
  radius: number;
  smear: number;
  alpha: number;
}

interface Block {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  rotation: number;
  vx: number;
  vy: number;
  isSettled: boolean;
  bloodMarks: BloodMark[];
  crushedBirdComboCount: number;
  comboPointsAwarded: number;
}

interface LifePrompt {
  blockId: number;
  scorePenalty: number;
  enforceMinStability: boolean;
  denyShake: number;
  acceptShake: number;
}

interface Bird {
  kind: 'normal' | 'white';
  x: number;
  baseY: number;
  vx: number;
  size: number;
  flapPhase: number;
  bobPhase: number;
  bobAmplitude: number;
  bobSpeed: number;
}

interface CloudSprite {
  x: number;
  y: number;
  scale: number;
  alpha: number;
  drift: number;
  parallax: number;
  stretch: number;
}

interface ForegroundCloudSprite {
  x: number;
  y: number;
  scale: number;
  alpha: number;
  speed: number;
  parallax: number;
  stretch: number;
  phase: number;
  windX: number;
  windY: number;
  disperse: number;
}

const BLOCK_SIZE = 60;
const BASE_WIDTH = 120;
const GRAVITY = 0.4;
const SWING_SPEED = 0.03;
const SWING_AMPLITUDE = 150;
const BIRD_MIN_SPAWN_MS = 1100;
const BIRD_MAX_SPAWN_MS = 2600;
const MAX_BIRDS_ON_SCREEN = 12;
const BIRD_SINGLE_KILL_POINTS = 5;
const BIRD_COMBO_TWO_POINTS = 20;
const BIRD_COMBO_THREE_POINTS = 80;
const BIRD_COMBO_FOUR_POINTS = 150;
const WHITE_BIRD_REWARD_POINTS = 100;
const WHITE_BIRD_NORMAL_INTERVAL = 30;
const BIRD_POINTS_PER_LIFE = 100;
const MAX_LIFE_BIRDS = 4;
const STORAGE_KEYS = {
  highScore: 'torre_high_score_v1',
  birdPoints: 'torre_bird_points_v1',
  deadBirds: 'torre_dead_birds_v1',
} as const;
const COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', 
  '#F7DC6F', '#BB8FCE', '#82E0AA', '#F1948A', '#85C1E9'
];

// --- Utility Functions ---

const getRandomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

const getSafeSwingAmplitude = (canvasWidth: number): number => {
  const edgeMargin = 18;
  const maxVisibleAmplitude = Math.max(0, canvasWidth / 2 - BLOCK_SIZE / 2 - edgeMargin);
  return Math.min(SWING_AMPLITUDE, maxVisibleAmplitude);
};

const getBirdWorldY = (bird: Bird): number => {
  return bird.baseY + Math.sin(bird.bobPhase) * bird.bobAmplitude;
};

const getBirdComboPoints = (crushedCount: number): number => {
  if (crushedCount <= 0) return 0;
  if (crushedCount === 1) return BIRD_SINGLE_KILL_POINTS;
  if (crushedCount === 2) return BIRD_COMBO_TWO_POINTS;
  if (crushedCount === 3) return BIRD_COMBO_THREE_POINTS;
  return BIRD_COMBO_FOUR_POINTS;
};

const getAvailableLifeBirds = (birdPoints: number): number => {
  const earnedLives = Math.floor(Math.max(0, birdPoints) / BIRD_POINTS_PER_LIFE);
  return Math.max(0, Math.min(MAX_LIFE_BIRDS, earnedLives));
};

const readStoredInt = (key: string, fallback = 0): number => {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  } catch {
    return fallback;
  }
};

const writeStoredInt = (key: string, value: number) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(key, String(Math.max(0, Math.floor(value))));
  } catch {
    // Keep gameplay running if storage is unavailable.
  }
};

const buildCloudSprites = (width: number, height: number): CloudSprite[] => {
  const count = width < 640 ? 18 : width < 980 ? 24 : 32;
  const verticalSpan = Math.max(2800, height * 3.8);
  const startY = -verticalSpan * 0.88;
  const lane = verticalSpan / Math.max(1, count - 1);
  let seed = Math.floor(width * 13 + height * 17) + 97;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const sprites: CloudSprite[] = [];
  for (let i = 0; i < count; i++) {
    const depth = 0.55 + rand() * 1.05;
    const jitterY = (rand() - 0.5) * lane * 0.68;
    const x = -width * 0.3 + rand() * (width * 1.6);
    const y = startY + i * lane + jitterY;
    const alpha = 0.14 + rand() * 0.22;
    const drift = (rand() - 0.5) * (width < 700 ? 28 : 44);
    const parallax = 0.12 + rand() * 0.16;
    const stretch = 1.2 + rand() * 1.15;
    sprites.push({
      x,
      y,
      scale: depth,
      alpha,
      drift,
      parallax,
      stretch,
    });
  }

  return sprites;
};

const buildForegroundCloudSprites = (width: number, height: number): ForegroundCloudSprite[] => {
  const count = width < 640 ? 6 : width < 980 ? 8 : 11;
  const verticalSpan = Math.max(height * 2.5, 1400);
  const startY = -verticalSpan * 0.78;
  const lane = verticalSpan / Math.max(1, count - 1);
  let seed = Math.floor(width * 19 + height * 11) + 431;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  const sprites: ForegroundCloudSprite[] = [];
  for (let i = 0; i < count; i++) {
    const depth = 0.75 + rand() * 1.05;
    const jitterY = (rand() - 0.5) * lane * 0.74;
    sprites.push({
      x: -width * 0.4 + rand() * (width * 1.8),
      y: startY + i * lane + jitterY,
      scale: depth,
      alpha: 0.2 + rand() * 0.18,
      speed: 0.012 + rand() * 0.026,
      parallax: 0.2 + rand() * 0.18,
      stretch: 1.25 + rand() * 1.35,
      phase: rand() * Math.PI * 2,
      windX: 0,
      windY: 0,
      disperse: 0,
    });
  }

  return sprites;
};

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [gameState, setGameState] = useState<GameState>('IDLE');
  const gameStateRef = useRef<GameState>('IDLE');
  useEffect(() => { gameStateRef.current = gameState; }, [gameState]);

  const [score, setScore] = useState(0);
  const scoreRef = useRef(0);
  useEffect(() => { scoreRef.current = score; }, [score]);

  const [birdPoints, setBirdPoints] = useState(() => readStoredInt(STORAGE_KEYS.birdPoints, 0));
  const birdPointsRef = useRef(birdPoints);
  useEffect(() => { birdPointsRef.current = birdPoints; }, [birdPoints]);
  useEffect(() => { writeStoredInt(STORAGE_KEYS.birdPoints, birdPoints); }, [birdPoints]);

  const [deadBirds, setDeadBirds] = useState(() => readStoredInt(STORAGE_KEYS.deadBirds, 0));
  const deadBirdsRef = useRef(deadBirds);
  useEffect(() => { deadBirdsRef.current = deadBirds; }, [deadBirds]);
  useEffect(() => { writeStoredInt(STORAGE_KEYS.deadBirds, deadBirds); }, [deadBirds]);

  const [comboFeedback, setComboFeedback] = useState<{ id: number; points: number; comboCount: number } | null>(null);
  const comboFeedbackIdRef = useRef(0);
  const [lifeFeedback, setLifeFeedback] = useState<{ id: number; gained: number } | null>(null);
  const lifeFeedbackIdRef = useRef(0);
  const [lifePrompt, setLifePrompt] = useState<LifePrompt | null>(null);
  const lifePromptRef = useRef<LifePrompt | null>(null);
  useEffect(() => { lifePromptRef.current = lifePrompt; }, [lifePrompt]);

  const [highScore, setHighScore] = useState(() => readStoredInt(STORAGE_KEYS.highScore, 0));
  const highScoreRef = useRef(highScore);
  useEffect(() => { highScoreRef.current = highScore; }, [highScore]);
  useEffect(() => { writeStoredInt(STORAGE_KEYS.highScore, highScore); }, [highScore]);

  const [stability, setStability] = useState(100);
  const stabilityRef = useRef(100);
  useEffect(() => { stabilityRef.current = stability; }, [stability]);

  const [lastPrecision, setLastPrecision] = useState<'PERFECT' | 'GOOD' | 'BAD' | null>(null);
  const [showTutorial, setShowTutorial] = useState(true);
  const handleBackToHub = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event('gamehub:back'));
  }, []);

  // Game Engine Refs
  const blocksRef = useRef<Block[]>([]);
  const nextBlockIdRef = useRef(0);
  const currentBlockRef = useRef<{ x: number; y: number; color: string; angle: number } | null>(null);
  const cameraYRef = useRef(0);
  const targetCameraYRef = useRef(0);
  const shakeRef = useRef(0);
  const cloudSpritesRef = useRef<CloudSprite[]>([]);
  const foregroundCloudSpritesRef = useRef<ForegroundCloudSprite[]>([]);
  const birdsRef = useRef<Bird[]>([]);
  const nextBirdSpawnAtRef = useRef(0);
  const normalBirdSpawnCounterRef = useRef(0);

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
    blocksRef.current = [];
    nextBlockIdRef.current = 0;
    birdsRef.current = [];
    nextBirdSpawnAtRef.current = performance.now() + 550;
    normalBirdSpawnCounterRef.current = 0;
    cameraYRef.current = 0;
    targetCameraYRef.current = 0;
    gameOverTriggeredRef.current = false;
    setScore(0);
    scoreRef.current = 0;
    setComboFeedback(null);
    setLifeFeedback(null);
    setLifePrompt(null);
    lifePromptRef.current = null;
    setStability(100);
    setLastPrecision(null);
    shakeRef.current = 0;
    setGameState('PLAYING');
    setShowTutorial(true);
    spawnBlock();
  }, [spawnBlock]);

  const dropBlock = useCallback(() => {
    if (gameStateRef.current !== 'PLAYING' || !currentBlockRef.current) return;
    if (lifePromptRef.current) return;

    if (showTutorial) setShowTutorial(false);

    const canvas = canvasRef.current;
    if (!canvas) return;

    const swingAmplitude = getSafeSwingAmplitude(canvas.width);
    const swingX = Math.sin(currentBlockRef.current.angle) * swingAmplitude;
    const dropX = canvas.width / 2 + swingX - BLOCK_SIZE / 2;
    
    // Calculate world Y based on screen Y (80) and current camera translation
    // to ensure the block starts exactly where the hook was visually.
    const worldYTranslate = cameraYRef.current + canvas.height * 0.4;
    const dropY = 80 - worldYTranslate; 

    const newBlock: Block = {
      id: nextBlockIdRef.current++,
      x: dropX,
      y: dropY,
      width: BLOCK_SIZE,
      height: BLOCK_SIZE,
      color: currentBlockRef.current.color,
      rotation: 0,
      vx: 0,
      vy: 0,
      isSettled: false,
      bloodMarks: [],
      crushedBirdComboCount: 0,
      comboPointsAwarded: 0,
    };

    blocksRef.current.push(newBlock);
    currentBlockRef.current = null;

    // Spawn next block
    setTimeout(() => {
      if (gameStateRef.current === 'PLAYING') spawnBlock();
    }, 800);
  }, [spawnBlock]);

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

  const addBirdPoints = useCallback((points: number) => {
    if (points <= 0) return;
    const previousLifeBirds = getAvailableLifeBirds(birdPointsRef.current);
    birdPointsRef.current += points;
    setBirdPoints(birdPointsRef.current);
    const nextLifeBirds = getAvailableLifeBirds(birdPointsRef.current);
    if (nextLifeBirds > previousLifeBirds) {
      setLifeFeedback({
        id: ++lifeFeedbackIdRef.current,
        gained: nextLifeBirds - previousLifeBirds,
      });
    }
  }, []);

  useEffect(() => {
    if (!comboFeedback) return;
    const timer = window.setTimeout(() => {
      setComboFeedback(null);
    }, 780);
    return () => window.clearTimeout(timer);
  }, [comboFeedback]);

  useEffect(() => {
    if (!lifeFeedback) return;
    const timer = window.setTimeout(() => {
      setLifeFeedback(null);
    }, 760);
    return () => window.clearTimeout(timer);
  }, [lifeFeedback]);

  const requestLifePrompt = useCallback((prompt: LifePrompt): boolean => {
    const availableLifeBirds = getAvailableLifeBirds(birdPointsRef.current);
    if (availableLifeBirds <= 0) return false;
    if (lifePromptRef.current) return true;
    setLifePrompt(prompt);
    return true;
  }, []);

  const handleLifePromptDecision = useCallback((useLife: boolean) => {
    const prompt = lifePromptRef.current;
    if (!prompt) return;

    setLifePrompt(null);

    if (!useLife) {
      setGameState('FALLING');
      shakeRef.current = prompt.denyShake;
      return;
    }

    const availableLifeBirds = getAvailableLifeBirds(birdPointsRef.current);
    if (availableLifeBirds <= 0) {
      setGameState('FALLING');
      shakeRef.current = prompt.denyShake;
      return;
    }

    birdPointsRef.current = Math.max(0, birdPointsRef.current - BIRD_POINTS_PER_LIFE);
    setBirdPoints(birdPointsRef.current);

    const targetIndex = blocksRef.current.findIndex((block) => block.id === prompt.blockId);
    if (targetIndex >= 0) {
      blocksRef.current.splice(targetIndex, 1);
    }

    if (prompt.scorePenalty > 0) {
      const nextScore = Math.max(0, scoreRef.current - prompt.scorePenalty);
      scoreRef.current = nextScore;
      setScore(nextScore);
    }

    if (prompt.enforceMinStability) {
      const recoveredStability = calculateStability();
      setStability(Math.max(20, recoveredStability));
    }

    shakeRef.current = prompt.acceptShake;
  }, [calculateStability]);

  const scheduleNextBirdSpawn = useCallback((time: number) => {
    nextBirdSpawnAtRef.current =
      time + BIRD_MIN_SPAWN_MS + Math.random() * (BIRD_MAX_SPAWN_MS - BIRD_MIN_SPAWN_MS);
  }, []);

  const spawnBird = useCallback((canvas: HTMLCanvasElement, time: number) => {
    const spawnWhiteBird = normalBirdSpawnCounterRef.current >= WHITE_BIRD_NORMAL_INTERVAL;
    const worldOffsetY = cameraYRef.current + canvas.height * 0.4;

    if (!spawnWhiteBird) {
      normalBirdSpawnCounterRef.current += 1;
      const fromLeft = Math.random() > 0.5;
      const size = 12 + Math.random() * 9;
      const speed = 1.2 + Math.random() * 1.7;
      const spawnScreenY = 95 + Math.random() * Math.max(95, canvas.height * 0.46);

      birdsRef.current.push({
        kind: 'normal',
        x: fromLeft ? -size * 3 : canvas.width + size * 3,
        baseY: spawnScreenY - worldOffsetY,
        vx: fromLeft ? speed : -speed,
        size,
        flapPhase: Math.random() * Math.PI * 2,
        bobPhase: Math.random() * Math.PI * 2,
        bobAmplitude: 1.5 + Math.random() * 4.5,
        bobSpeed: 0.05 + Math.random() * 0.05,
      });
    } else {
      normalBirdSpawnCounterRef.current = 0;
      const swingAmplitude = getSafeSwingAmplitude(canvas.width);
      const hookX = currentBlockRef.current
        ? canvas.width / 2 + Math.sin(currentBlockRef.current.angle) * swingAmplitude
        : canvas.width / 2;
      const safeWhiteX = Math.max(24, Math.min(canvas.width - 24, hookX + (Math.random() - 0.5) * 24));
      const spawnScreenY = 122 + Math.random() * 42;
      const driftDirection = Math.random() > 0.5 ? 1 : -1;

      birdsRef.current.push({
        kind: 'white',
        x: safeWhiteX,
        baseY: spawnScreenY - worldOffsetY,
        vx: driftDirection * (0.12 + Math.random() * 0.22),
        size: 13 + Math.random() * 8,
        flapPhase: Math.random() * Math.PI * 2,
        bobPhase: Math.random() * Math.PI * 2,
        bobAmplitude: 1 + Math.random() * 2.2,
        bobSpeed: 0.03 + Math.random() * 0.03,
      });
    }

    if (birdsRef.current.length > MAX_BIRDS_ON_SCREEN) {
      const removableNormalIndex = birdsRef.current.findIndex((bird) => bird.kind === 'normal');
      birdsRef.current.splice(removableNormalIndex >= 0 ? removableNormalIndex : 0, 1);
    }

    scheduleNextBirdSpawn(time);
  }, [scheduleNextBirdSpawn]);

  const drawBird = useCallback((ctx: CanvasRenderingContext2D, bird: Bird) => {
    const birdY = getBirdWorldY(bird);
    const wingLift = Math.sin(bird.flapPhase) * bird.size * 0.35;
    const wingDrop = Math.cos(bird.flapPhase) * bird.size * 0.25;
    const palette = bird.kind === 'white'
      ? {
        body: '#f8fafc',
        wingDark: '#e2e8f0',
        wingLight: '#cbd5e1',
        head: '#f1f5f9',
      }
      : {
        body: '#5a4334',
        wingDark: '#3d2a20',
        wingLight: '#6f4d3c',
        head: '#4a3529',
      };

    ctx.save();
    ctx.translate(bird.x, birdY);
    if (bird.vx < 0) ctx.scale(-1, 1);
    ctx.shadowBlur = 0;

    ctx.fillStyle = palette.body;
    ctx.beginPath();
    ctx.ellipse(-bird.size * 0.05, 0, bird.size * 0.9, bird.size * 0.62, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = palette.wingDark;
    ctx.beginPath();
    ctx.moveTo(-bird.size * 0.4, -bird.size * 0.08);
    ctx.quadraticCurveTo(-bird.size * 0.95, -bird.size * 0.58 - wingLift, -bird.size * 0.35, -bird.size * 0.42 + wingDrop);
    ctx.quadraticCurveTo(-bird.size * 0.16, -bird.size * 0.2, -bird.size * 0.4, -bird.size * 0.08);
    ctx.fill();

    ctx.fillStyle = palette.wingLight;
    ctx.beginPath();
    ctx.moveTo(bird.size * 0.1, -bird.size * 0.02);
    ctx.quadraticCurveTo(bird.size * 0.65, -bird.size * 0.55 - wingLift * 0.65, bird.size * 0.35, -bird.size * 0.35 + wingDrop);
    ctx.quadraticCurveTo(bird.size * 0.18, -bird.size * 0.15, bird.size * 0.1, -bird.size * 0.02);
    ctx.fill();

    ctx.fillStyle = palette.head;
    ctx.beginPath();
    ctx.arc(bird.size * 0.72, -bird.size * 0.24, bird.size * 0.34, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.moveTo(bird.size * 1.02, -bird.size * 0.19);
    ctx.lineTo(bird.size * 1.46, -bird.size * 0.08);
    ctx.lineTo(bird.size * 1.02, bird.size * 0.02);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.arc(bird.size * 0.82, -bird.size * 0.28, Math.max(1.5, bird.size * 0.08), 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }, []);

  const crushBirdsUnderBlock = useCallback((block: Block, blockVy: number) => {
    if (blockVy <= 0 || birdsRef.current.length === 0) return;
    const nextBirds: Bird[] = [];
    let crushedNormalCount = 0;
    let crushedWhiteCount = 0;

    for (let i = 0; i < birdsRef.current.length; i++) {
      const bird = birdsRef.current[i];
      const birdY = getBirdWorldY(bird);
      const birdRadius = bird.size * 0.45;
      const overlapX = bird.x + birdRadius > block.x && bird.x - birdRadius < block.x + block.width;
      const overlapY = birdY + birdRadius > block.y && birdY - birdRadius < block.y + block.height;
      const isUnderBlock = birdY >= block.y + block.height * 0.16;

      if (overlapX && overlapY && isUnderBlock) {
        const centerX = block.x + block.width / 2;
        const centerY = block.y + block.height / 2;
        const localX = Math.max(-block.width / 2 + 6, Math.min(block.width / 2 - 6, bird.x - centerX));
        const localY = Math.max(-block.height / 2 + 6, Math.min(block.height / 2 - 6, birdY - centerY));

        block.bloodMarks.push({
          x: localX,
          y: localY,
          radius: 7 + Math.random() * 6,
          smear: 8 + Math.random() * 12,
          alpha: 0.5 + Math.random() * 0.28,
        });

        const droplets = 1 + Math.floor(Math.random() * 2);
        for (let d = 0; d < droplets; d++) {
          const angle = (Math.random() - 0.5) * Math.PI;
          const distance = 7 + Math.random() * 12;
          block.bloodMarks.push({
            x: localX + Math.cos(angle) * distance,
            y: localY + Math.sin(angle) * distance * 0.6,
            radius: 2 + Math.random() * 2.4,
            smear: 2 + Math.random() * 5,
            alpha: 0.42 + Math.random() * 0.28,
          });
        }

        if (block.bloodMarks.length > 16) {
          block.bloodMarks.splice(0, block.bloodMarks.length - 16);
        }
        if (bird.kind === 'white') crushedWhiteCount++;
        else crushedNormalCount++;
      } else {
        nextBirds.push(bird);
      }
    }

    birdsRef.current = nextBirds;
    const crushedTotal = crushedNormalCount + crushedWhiteCount;
    if (crushedTotal > 0) {
      let gainedPoints = 0;
      let feedbackComboCount = 1;

      if (crushedNormalCount > 0) {
        block.crushedBirdComboCount += crushedNormalCount;
        const comboPoints = getBirdComboPoints(block.crushedBirdComboCount);
        const pointsDelta = Math.max(0, comboPoints - block.comboPointsAwarded);
        if (pointsDelta > 0) {
          addBirdPoints(pointsDelta);
          gainedPoints += pointsDelta;
          block.comboPointsAwarded = comboPoints;
        }
        feedbackComboCount = block.crushedBirdComboCount;
      }

      if (crushedWhiteCount > 0) {
        const whiteReward = crushedWhiteCount * WHITE_BIRD_REWARD_POINTS;
        addBirdPoints(whiteReward);
        gainedPoints += whiteReward;
      }

      deadBirdsRef.current += crushedTotal;
      setDeadBirds(deadBirdsRef.current);
      if (gainedPoints > 0) {
        setComboFeedback({
          id: ++comboFeedbackIdRef.current,
          points: gainedPoints,
          comboCount: feedbackComboCount,
        });
      }
      shakeRef.current = Math.max(shakeRef.current, 6);
    }
  }, [addBirdPoints]);

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

    // Pause simulation while waiting for the in-game life decision.
    if (lifePromptRef.current) return;

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

    const altitudeFog = Math.max(0, Math.min(1, (scoreRef.current - 18) / 20));

    // Draw Clouds (Parallax)
    ctx.save();
    if (cloudSpritesRef.current.length === 0) {
      cloudSpritesRef.current = buildCloudSprites(canvas.width, canvas.height);
    }
    const cloudClock = time * 0.00032;
    for (let i = 0; i < cloudSpritesRef.current.length; i++) {
      const cloud = cloudSpritesRef.current[i];
      const x = cloud.x + Math.sin(cloudClock + i * 0.91) * cloud.drift;
      const y = cloud.y + cameraYRef.current * cloud.parallax;
      const densityBoost = 1 + altitudeFog * (0.18 + (1 - cloud.parallax) * 0.24);
      const w = 130 * cloud.scale * cloud.stretch * densityBoost;
      const h = 44 * cloud.scale * (1 + altitudeFog * 0.16);
      const alpha = Math.min(0.75, cloud.alpha + altitudeFog * (0.08 + (1 - cloud.parallax) * 0.07));

      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath();
      ctx.ellipse(x - w * 0.28, y + h * 0.03, w * 0.33, h * 0.62, 0, 0, Math.PI * 2);
      ctx.ellipse(x, y - h * 0.18, w * 0.36, h * 0.74, 0, 0, Math.PI * 2);
      ctx.ellipse(x + w * 0.31, y + h * 0.06, w * 0.28, h * 0.56, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = `rgba(255,255,255,${alpha * 0.5})`;
      ctx.beginPath();
      ctx.ellipse(x, y + h * 0.3, w * 0.52, h * 0.44, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    // Translate world so y=0 (base) is near bottom, and tower grows UP (negative y)
    // We want the top of the tower (at -cameraYRef) to be around 0.3 * height
    ctx.translate(0, cameraYRef.current + canvas.height * 0.4);

    if ((currentState === 'PLAYING' || currentState === 'FALLING')
      && (nextBirdSpawnAtRef.current === 0 || time >= nextBirdSpawnAtRef.current)
    ) {
      spawnBird(canvas, time);
    }

    if (birdsRef.current.length > 0) {
      const worldOffsetY = cameraYRef.current + canvas.height * 0.4;
      birdsRef.current = birdsRef.current.filter((bird) => {
        bird.x += bird.vx;
        bird.flapPhase += 0.28 + Math.abs(bird.vx) * 0.055;
        bird.bobPhase += bird.bobSpeed;

        const birdY = getBirdWorldY(bird);
        const screenY = birdY + worldOffsetY;
        return bird.x > -120 && bird.x < canvas.width + 120 && screenY > -180 && screenY < canvas.height + 220;
      });
    }

    // Draw Base
    ctx.fillStyle = '#475569';
    ctx.fillRect(canvas.width / 2 - BASE_WIDTH / 2, 0, BASE_WIDTH, 20);

    for (let i = 0; i < birdsRef.current.length; i++) {
      drawBird(ctx, birdsRef.current[i]);
    }

    // Update and Draw Blocks
    const movingBlockPoints: Array<{ x: number; y: number; vx: number; vy: number }> = [];
    blocksRef.current.forEach((block, index) => {
      if (!block.isSettled && currentState !== 'FALLING') {
        block.vy += GRAVITY;
        block.y += block.vy;
        crushBirdsUnderBlock(block, block.vy);

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

              const currentStability = calculateStability();
              if (currentStability <= 0) {
                if (requestLifePrompt({
                  blockId: block.id,
                  scorePenalty: 1,
                  enforceMinStability: true,
                  denyShake: 20,
                  acceptShake: 14,
                })) {
                  return;
                }
                setGameState('FALLING');
                shakeRef.current = 20; // Collapse shake
              }
            } else {
              if (requestLifePrompt({
                blockId: block.id,
                scorePenalty: 0,
                enforceMinStability: false,
                denyShake: 10,
                acceptShake: 12,
              })) {
                return;
              }
              setGameState('FALLING');
              shakeRef.current = 10; // Miss shake
            }
          }
        }
      }

      // Draw Block
      ctx.save();
      
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
          crushBirdsUnderBlock(block, block.vy);
        }
      }

      ctx.translate(block.x + block.width / 2, block.y + block.height / 2);
      if (currentState === 'FALLING' || currentState === 'GAME_OVER') {
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

      if (block.bloodMarks.length > 0) {
        ctx.shadowBlur = 0;
        for (let i = 0; i < block.bloodMarks.length; i++) {
          const stain = block.bloodMarks[i];
          ctx.fillStyle = `rgba(126, 9, 9, ${stain.alpha})`;
          ctx.beginPath();
          ctx.ellipse(stain.x, stain.y, stain.radius, stain.radius * 0.76, 0, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = `rgba(80, 0, 0, ${Math.min(0.95, stain.alpha + 0.08)})`;
          ctx.beginPath();
          ctx.ellipse(stain.x, stain.y + stain.smear * 0.36, stain.radius * 0.36, stain.smear, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      
      if (lastPrecision === 'PERFECT' && index === blocksRef.current.length - 1 && block.isSettled) {
        ctx.strokeStyle = 'rgba(255,255,255,0.8)';
        ctx.lineWidth = 4;
        ctx.stroke();
      }

      if (!block.isSettled) {
        movingBlockPoints.push({
          x: block.x + block.width / 2,
          y: block.y + cameraYRef.current + canvas.height * 0.4,
          vx: block.vx,
          vy: block.vy,
        });
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
        const runBlocks = Math.max(1, scoreRef.current);
        if (runBlocks > highScoreRef.current) {
          setHighScore(runBlocks);
        }
        return; 
      }
    }

    ctx.restore();

    // Draw foreground clouds in front of stacked blocks with lightweight wind reaction.
    if (foregroundCloudSpritesRef.current.length === 0) {
      foregroundCloudSpritesRef.current = buildForegroundCloudSprites(canvas.width, canvas.height);
    }
    const motionTime = time * 0.001;
    const laneWidth = canvas.width + 560;
    for (let i = 0; i < foregroundCloudSpritesRef.current.length; i++) {
      const cloud = foregroundCloudSpritesRef.current[i];
      const driftX = motionTime * cloud.speed * 1000;
      const wrappedX = ((cloud.x + driftX) % laneWidth + laneWidth) % laneWidth - 280;
      const baseY = cloud.y + cameraYRef.current * cloud.parallax;

      cloud.windX *= 0.92;
      cloud.windY *= 0.9;
      cloud.disperse *= 0.93;

      const influenceRadius = 150 * cloud.scale;
      const influenceRadiusSq = influenceRadius * influenceRadius;
      for (let j = 0; j < movingBlockPoints.length; j++) {
        const point = movingBlockPoints[j];
        const dx = point.x - (wrappedX + cloud.windX);
        const dy = point.y - (baseY + cloud.windY);
        const distSq = dx * dx + dy * dy;
        if (distSq > influenceRadiusSq) continue;

        const dist = Math.sqrt(Math.max(1, distSq));
        const ratio = 1 - dist / influenceRadius;
        const velocityBoost = Math.min(1.5, Math.abs(point.vy) * 0.12 + Math.abs(point.vx) * 0.08);
        const push = ratio * (0.3 + velocityBoost);
        cloud.windX = Math.max(-30, Math.min(30, cloud.windX + (dx / dist) * push * 2.6 + point.vx * 0.12));
        cloud.windY = Math.max(-16, Math.min(16, cloud.windY + (dy / dist) * push * 0.95 + point.vy * 0.09));
        cloud.disperse = Math.min(1.25, cloud.disperse + push * 0.16);
      }

      const cloudX = wrappedX + cloud.windX + Math.sin(motionTime * 0.55 + cloud.phase) * 10 * cloud.scale;
      const cloudY = baseY + cloud.windY + Math.cos(motionTime * 0.31 + cloud.phase * 1.2) * 3.2 * cloud.scale;
      const spread = (1 + cloud.disperse * 0.58) * (1 + altitudeFog * 0.5);
      const width = 190 * cloud.scale * cloud.stretch * spread;
      const height = 58 * cloud.scale * (1 + cloud.disperse * 0.24 + altitudeFog * 0.2);
      const alpha = Math.max(0.05, Math.min(0.86, (cloud.alpha + altitudeFog * 0.16) * (1 - cloud.disperse * 0.36)));

      ctx.fillStyle = `rgba(255,255,255,${alpha})`;
      ctx.beginPath();
      ctx.ellipse(cloudX - width * 0.29, cloudY + height * 0.05, width * 0.31, height * 0.57, 0, 0, Math.PI * 2);
      ctx.ellipse(cloudX + width * 0.02, cloudY - height * 0.22, width * 0.36, height * 0.73, 0, 0, Math.PI * 2);
      ctx.ellipse(cloudX + width * 0.34, cloudY + height * 0.06, width * 0.27, height * 0.52, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = `rgba(255,255,255,${alpha * 0.45})`;
      ctx.beginPath();
      ctx.ellipse(cloudX, cloudY + height * 0.34, width * 0.55, height * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    if (altitudeFog > 0) {
      const fogGradient = ctx.createLinearGradient(0, 0, 0, canvas.height * 0.82);
      fogGradient.addColorStop(0, `rgba(255,255,255,${0.2 * altitudeFog})`);
      fogGradient.addColorStop(0.5, `rgba(255,255,255,${0.1 * altitudeFog})`);
      fogGradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = fogGradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height * 0.82);

      const fogClock = time * 0.00018;
      const fogLayers = canvas.width < 680 ? 3 : 5;
      const fogTop = canvas.height * 0.14;
      const fogStep = canvas.height * 0.11;
      for (let i = 0; i < fogLayers; i++) {
        const fx = canvas.width * (0.5 + Math.sin(fogClock + i * 1.12) * 0.16);
        const fy = fogTop + i * fogStep + Math.cos(fogClock * 0.7 + i * 0.94) * 9;
        const fw = canvas.width * (0.54 + i * 0.18) * (1 + altitudeFog * 0.3);
        const fh = (26 + i * 12) * (1 + altitudeFog * 1.35);
        const layerAlpha = altitudeFog * (0.05 + i * 0.012);
        ctx.fillStyle = `rgba(255,255,255,${layerAlpha})`;
        ctx.beginPath();
        ctx.ellipse(fx, fy, fw, fh, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Draw Swinging Block
    if (currentState === 'PLAYING' && currentBlockRef.current) {
      const speedMultiplier = 1 + Math.floor(scoreRef.current / 10) * 0.2;
      currentBlockRef.current.angle += SWING_SPEED * speedMultiplier;
      
      const swingAmplitude = getSafeSwingAmplitude(canvas.width);
      const swingX = Math.sin(currentBlockRef.current.angle) * swingAmplitude;
      const x = canvas.width / 2 + swingX;
      const y = 80; // Relative to screen top

      // Guide line for where the block will be released.
      const guideAlpha = showTutorial ? 0.24 : 0.14;
      ctx.setLineDash(showTutorial ? [6, 5] : [4, 8]);
      ctx.lineWidth = showTutorial ? 2 : 1.5;
      ctx.strokeStyle = `rgba(15, 23, 42, ${guideAlpha})`;
      ctx.beginPath();
      ctx.moveTo(x, y + BLOCK_SIZE);
      ctx.lineTo(x, canvas.height);
      ctx.stroke();
      ctx.setLineDash([]);

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
      ctx.fillStyle = currentBlockRef.current.color;
      ctx.shadowBlur = 20;
      ctx.shadowColor = 'rgba(0,0,0,0.15)';
      const r = 8;
      ctx.beginPath();
      ctx.roundRect(-BLOCK_SIZE / 2, 0, BLOCK_SIZE, BLOCK_SIZE, r);
      ctx.fill();
      ctx.restore();
    }
  }, [calculateStability, crushBirdsUnderBlock, drawBird, requestLifePrompt, spawnBird]);

  const updateRef = useRef(update);
  useEffect(() => {
    updateRef.current = update;
  }, [update]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const viewport = window.visualViewport;

    const handleResize = () => {
      const width = Math.floor(viewport?.width ?? window.innerWidth);
      const height = Math.floor(viewport?.height ?? window.innerHeight);
      canvas.width = width;
      canvas.height = height;
      cloudSpritesRef.current = buildCloudSprites(width, height);
      foregroundCloudSpritesRef.current = buildForegroundCloudSprites(width, height);
    };

    window.addEventListener('resize', handleResize);
    viewport?.addEventListener('resize', handleResize);
    handleResize();
    const settleTimer = window.setTimeout(handleResize, 140);

    let frameId: number;
    const loop = (time: number) => {
      updateRef.current(time);
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener('resize', handleResize);
      viewport?.removeEventListener('resize', handleResize);
      window.clearTimeout(settleTimer);
      cancelAnimationFrame(frameId);
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat) return;

      const activeTag = (document.activeElement as HTMLElement | null)?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

      event.preventDefault();
      dropBlock();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [dropBlock]);

  // --- Render ---

  const availableLifeBirds = getAvailableLifeBirds(birdPoints);
  const gameOverBlocks = Math.max(1, score);

  return (
    <div className="relative w-full h-[100dvh] overflow-hidden bg-sky-50 font-sans select-none touch-manipulation">
      <canvas
        ref={canvasRef}
        onPointerDown={dropBlock}
        className="block w-full h-full cursor-pointer"
      />

      {/* Global pigeon totals (always visible) */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-[120] pointer-events-none">
        <div className="flex items-center gap-2">
          <div className="px-3 py-1.5 rounded-full bg-slate-900/82 text-white border border-white/20 inline-flex items-center gap-2">
            <BirdLifeIcon className="w-3.5 h-3.5 text-amber-300" />
            <span className="tabular-nums text-amber-300 text-sm font-black">{deadBirds}</span>
          </div>
        </div>
      </div>

      {/* HUD */}
      <div className="absolute top-0 left-0 w-full p-6 flex justify-between items-start pointer-events-none">
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={handleBackToHub}
            className="pointer-events-auto w-fit px-3 py-1 rounded-full bg-white/85 border border-white/80 text-[11px] font-black uppercase tracking-wide text-slate-700 hover:bg-white transition-colors"
          >
            Voltar
          </button>
          <div className="text-slate-500 text-xs font-bold uppercase tracking-widest">Blocos</div>
          <div className="text-4xl font-black text-slate-800 tabular-nums">{score}</div>
        </div>

        <div className="flex flex-col items-end gap-2">
          <div className="bg-white/80 backdrop-blur-md px-4 py-2 rounded-2xl shadow-sm border border-white/20 flex items-center gap-2">
            <Trophy className="w-4 h-4 text-amber-500" />
            <span className="text-sm font-bold text-slate-700">{highScore}</span>
          </div>
          
          <div className="w-32 h-2 bg-slate-200 rounded-full overflow-hidden">
            <motion.div 
              className={`h-full ${stability > 60 ? 'bg-emerald-500' : stability > 30 ? 'bg-amber-500' : 'bg-rose-500'}`}
              initial={{ width: '100%' }}
              animate={{ width: `${stability}%` }}
            />
          </div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">Estabilidade</div>
          <div className="flex items-center gap-1.5">
            {Array.from({ length: MAX_LIFE_BIRDS }).map((_, index) => (
              <div
                key={index}
                className={`w-5 h-5 rounded-full flex items-center justify-center border ${
                  index < availableLifeBirds
                    ? 'bg-emerald-500/85 border-emerald-200/70 text-white'
                    : 'bg-slate-200/65 border-slate-300/70 text-slate-400'
                }`}
              >
                <BirdLifeIcon className="w-3.5 h-3.5" />
              </div>
            ))}
          </div>
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-tighter">
            Vidas ({availableLifeBirds}/{MAX_LIFE_BIRDS})
          </div>
        </div>
      </div>

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

      <AnimatePresence>
        {comboFeedback && gameState === 'PLAYING' && (
          <motion.div
            key={comboFeedback.id}
            initial={{ opacity: 0, y: 26, scale: 0.76, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -30, scale: 1.08, filter: 'blur(2px)' }}
            className="absolute top-[40%] left-1/2 -translate-x-1/2 pointer-events-none z-40"
          >
            <motion.div
              initial={{ boxShadow: '0 0 0 rgba(0,0,0,0)' }}
              animate={{
                boxShadow: comboFeedback.comboCount > 1
                  ? '0 0 44px rgba(245, 158, 11, 0.55)'
                  : '0 0 36px rgba(16, 185, 129, 0.5)',
              }}
              className={`relative px-5 py-2 rounded-2xl border backdrop-blur-md ${
                comboFeedback.comboCount > 1
                  ? 'bg-amber-500/85 border-amber-200/70 text-white'
                  : 'bg-emerald-500/85 border-emerald-200/70 text-white'
              }`}
            >
              <span className="text-2xl font-black tracking-tight tabular-nums">
                +{comboFeedback.points}P
              </span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {lifeFeedback && gameState === 'PLAYING' && (
          <motion.div
            key={lifeFeedback.id}
            initial={{ opacity: 0, y: 10, scale: 0.9 }}
            animate={{ opacity: 1, y: -8, scale: 1 }}
            exit={{ opacity: 0, y: -26, scale: 0.95 }}
            className="absolute top-24 left-6 pointer-events-none"
          >
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-600/90 text-white text-xs font-black uppercase tracking-wider shadow-lg">
              +{lifeFeedback.gained} Vida
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {lifePrompt && (
        <div className="absolute inset-0 bg-slate-900/45 backdrop-blur-sm flex items-center justify-center p-6 z-[85]">
          <motion.div
            initial={{ opacity: 0, y: 24, scale: 0.92 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            className="w-full max-w-sm bg-white rounded-3xl border border-slate-200 shadow-2xl p-6 text-center pointer-events-auto"
          >
            <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mb-4">
              <BirdLifeIcon className="w-7 h-7" />
            </div>
            <h3 className="text-xl font-black text-slate-800 tracking-tight mb-2">Usar Vida?</h3>
            <p className="text-sm text-slate-600 mb-5">
              Voce caiu. Deseja gastar <strong>{BIRD_POINTS_PER_LIFE}</strong> pontos de pombo para continuar de onde parou?
            </p>
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-5">
              Vidas disponiveis: {availableLifeBirds}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleLifePromptDecision(false)}
                className="py-3 rounded-2xl bg-slate-100 text-slate-700 font-black uppercase tracking-wide hover:bg-slate-200 active:scale-[0.98] transition-all"
              >
                Nao
              </button>
              <button
                type="button"
                onClick={() => handleLifePromptDecision(true)}
                className="py-3 rounded-2xl bg-emerald-600 text-white font-black uppercase tracking-wide hover:bg-emerald-500 active:scale-[0.98] transition-all"
              >
                Sim
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Overlays */}
      {gameState === 'IDLE' && (
        <div className="absolute inset-0 bg-white/40 backdrop-blur-sm flex flex-col items-center justify-center p-8 text-center z-50">
          <motion.h1 
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="text-6xl font-black text-slate-800 mb-2 tracking-tighter"
          >
            EQUILÍBRIO<br/>DE TORRE
          </motion.h1>
          <p className="text-slate-500 mb-8 max-w-xs">
            Solte os blocos no momento perfeito para construir uma torre estável. Não deixe cair!
          </p>
          <button
            onClick={initGame}
            className="group relative px-8 py-4 bg-slate-800 text-white rounded-2xl font-bold text-xl shadow-xl hover:bg-slate-700 transition-all active:scale-95 pointer-events-auto"
          >
            <div className="flex items-center gap-2">
              <Play className="w-6 h-6 fill-current" />
              INICIAR JOGO
            </div>
          </button>
        </div>
      )}

      {gameState === 'GAME_OVER' && (
        <div className="absolute inset-0 bg-slate-900/90 backdrop-blur-xl flex flex-col items-center justify-center p-8 text-center text-white z-50">
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-white/10 p-12 rounded-[3rem] border border-white/10 shadow-2xl max-w-sm w-full"
          >
            <div className="w-20 h-20 bg-rose-500 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-rose-500/40">
              <AlertTriangle className="w-10 h-10 text-white" />
            </div>
            
            <h2 className="text-4xl font-black mb-1 tracking-tighter uppercase">A Torre Caiu!</h2>
            <p className="text-white/50 text-sm font-bold uppercase tracking-widest mb-8">Fim de Jogo</p>
            
            <div className="grid grid-cols-2 gap-4 mb-10">
              <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                <div className="text-[10px] uppercase font-bold text-white/40 tracking-widest mb-1">Blocos</div>
                <div className="text-3xl font-black tabular-nums">{gameOverBlocks}</div>
              </div>
              <div className="bg-white/5 p-4 rounded-2xl border border-white/5">
                <div className="text-[10px] uppercase font-bold text-white/40 tracking-widest mb-1">Melhor</div>
                <div className="text-3xl font-black tabular-nums">{highScore}</div>
              </div>
            </div>

            <div className="mb-8 text-[11px] uppercase tracking-wider text-white/60 font-bold">
              Pombos Mortos (Geral): <span className="text-white">{deadBirds}</span> · Pontos de Pombo (Geral): <span className="text-white">{birdPoints}</span>
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
            {/* Centered touch hint */}
            <motion.div
              animate={{
                y: [140, 132, 140],
                scale: [1, 0.94, 1],
              }}
              transition={{
                repeat: Infinity,
                duration: 1.2,
                ease: 'easeInOut',
              }}
              className="absolute left-1/2 -translate-x-1/2 text-slate-800"
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
          className="absolute bottom-12 left-1/2 -translate-x-1/2 text-slate-400 font-bold text-sm uppercase tracking-widest animate-pulse"
        >
          Toque para Soltar
        </motion.div>
      )}
    </div>
  );
}
