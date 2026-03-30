/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
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

const BLOCK_SIZE = 60;
const BASE_WIDTH = 120;
const GRAVITY = 0.4;
const SWING_SPEED = 0.03;
const SWING_AMPLITUDE = 150;
const COLORS = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', 
  '#F7DC6F', '#BB8FCE', '#82E0AA', '#F1948A', '#85C1E9'
];

// --- Utility Functions ---

const getRandomColor = () => COLORS[Math.floor(Math.random() * COLORS.length)];

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

  // Game Engine Refs
  const blocksRef = useRef<Block[]>([]);
  const currentBlockRef = useRef<{ x: number; y: number; color: string; angle: number } | null>(null);
  const cameraYRef = useRef(0);
  const targetCameraYRef = useRef(0);
  const shakeRef = useRef(0);

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
    cameraYRef.current = 0;
    targetCameraYRef.current = 0;
    gameOverTriggeredRef.current = false;
    setScore(0);
    setStability(100);
    setLastPrecision(null);
    shakeRef.current = 0;
    setGameState('PLAYING');
    setShowTutorial(true);
    spawnBlock();
  }, [spawnBlock]);

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
      const speedMultiplier = 1 + Math.floor(scoreRef.current / 10) * 0.2;
      currentBlockRef.current.angle += SWING_SPEED * speedMultiplier;
      
      const swingX = Math.sin(currentBlockRef.current.angle) * SWING_AMPLITUDE;
      const x = canvas.width / 2 + swingX;
      const y = 80; // Relative to screen top

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
      ctx.fillStyle = currentBlockRef.current.color;
      ctx.shadowBlur = 20;
      ctx.shadowColor = 'rgba(0,0,0,0.15)';
      const r = 8;
      ctx.beginPath();
      ctx.roundRect(-BLOCK_SIZE / 2, 0, BLOCK_SIZE, BLOCK_SIZE, r);
      ctx.fill();
      ctx.restore();
    }
  }, [calculateStability]);

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

  // --- Render ---

  return (
    <div className="relative w-full h-[100dvh] overflow-hidden bg-sky-50 font-sans select-none touch-manipulation">
      <canvas
        ref={canvasRef}
        onPointerDown={dropBlock}
        className="block w-full h-full cursor-pointer"
      />

      {/* HUD */}
      <div className="absolute top-0 left-0 w-full p-6 flex justify-between items-start pointer-events-none">
        <div className="flex flex-col gap-1">
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
          className="absolute bottom-12 left-1/2 -translate-x-1/2 text-slate-400 font-bold text-sm uppercase tracking-widest animate-pulse"
        >
          Toque para Soltar
        </motion.div>
      )}
    </div>
  );
}
