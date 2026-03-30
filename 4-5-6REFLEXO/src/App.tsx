/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Play, RotateCcw, CheckCircle2, XCircle, Eye, History, X, ChevronLeft } from 'lucide-react';

type GameState = 'idle' | 'countdown' | 'reveal' | 'input' | 'result';

interface HistoryItem {
  target: string;
  user: string;
  isCorrect: boolean;
  timestamp: number;
}

export default function App() {
  const [gameState, setGameState] = useState<GameState>('idle');
  const [numDigits, setNumDigits] = useState<number>(4);
  const [targetNumber, setTargetNumber] = useState<string>('');
  const [userInput, setUserInput] = useState<string>('');
  const [countdown, setCountdown] = useState<number>(3);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const handleBackToHub = () => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new Event('gamehub:back'));
  };

  const generateNumber = () => {
    const min = Math.pow(10, numDigits - 1);
    const max = Math.pow(10, numDigits) - 1;
    const num = Math.floor(min + Math.random() * (max - min + 1)).toString();
    setTargetNumber(num);
  };

  const startGame = () => {
    generateNumber();
    setUserInput('');
    setIsCorrect(null);
    setCountdown(3);
    setGameState('countdown');
  };

  const checkNumber = () => {
    if (userInput.length === 0) return;
    const correct = userInput === targetNumber;
    setIsCorrect(correct);
    setGameState('result');
    
    setHistory(prev => [{
      target: targetNumber,
      user: userInput,
      isCorrect: correct,
      timestamp: Date.now()
    }, ...prev]);
  };

  useEffect(() => {
    if (gameState === 'countdown') {
      if (countdown > 0) {
        const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
        return () => clearTimeout(timer);
      } else {
        // Small delay to let the last number (1) disappear before reveal
        const timer = setTimeout(() => {
          setGameState('reveal');
        }, 300);
        return () => clearTimeout(timer);
      }
    }
  }, [gameState, countdown]);

  useEffect(() => {
    if (gameState === 'reveal') {
      const duration = numDigits === 4 ? 80 : numDigits === 5 ? 100 : 120;
      const timer = setTimeout(() => {
        setGameState('input');
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [gameState, numDigits]);

  useEffect(() => {
    if ((gameState === 'reveal' || gameState === 'input') && inputRef.current) {
      inputRef.current.focus();
    }
  }, [gameState]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/\D/g, '').slice(0, numDigits);
    setUserInput(value);
  };

  return (
    <div className="h-[100dvh] w-screen bg-[#f0f4f8] flex flex-col font-sans text-slate-800 overflow-hidden fixed inset-0 touch-manipulation select-none">
      {/* Top Bar */}
      <header className="h-12 bg-white/80 backdrop-blur-md border-b border-slate-200 z-50 flex items-center justify-between px-6 flex-shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleBackToHub}
            className="px-2.5 py-1 rounded-full border border-slate-300 text-[11px] font-black uppercase tracking-wide text-slate-700 hover:bg-slate-100 transition-colors"
          >
            Voltar
          </button>
          {gameState !== 'idle' ? (
            <button
              onClick={() => setGameState('idle')}
              className="flex items-center gap-1 text-slate-600 hover:text-blue-600 transition-colors"
            >
              <ChevronLeft size={18} />
              <span className="text-xs font-bold uppercase tracking-wider">Rodada</span>
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-600 rounded-full animate-pulse" />
              <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Menu</span>
            </div>
          )}
        </div>
        <button 
          onClick={() => setShowHistory(true)}
          className="flex items-center gap-2 text-slate-600 hover:text-blue-600 transition-colors"
        >
          <History size={16} />
          <span className="text-xs font-bold uppercase tracking-wider">Histórico</span>
        </button>
      </header>

      {/* Background Decoration */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none opacity-20">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-200 rounded-full blur-3xl" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-indigo-200 rounded-full blur-3xl" />
      </div>

      <main className="flex-1 flex flex-col items-center justify-center p-4 relative overflow-hidden sm:pt-16">
        <div className="w-full max-w-xl relative z-10 flex-shrink-0 sm:mt-12">
          <div className="relative h-48 sm:h-64 flex items-center justify-center mb-6 sm:mb-12 flex-shrink-0">
            {/* Hands and Paper Container */}
          <div className="relative w-full max-w-[500px] h-full flex items-center justify-center">
            
            {/* Left Hand */}
            <motion.div 
              className="absolute left-1/2 z-20"
              initial={{ x: -80 }}
              animate={{ 
                x: (gameState === 'reveal' || gameState === 'result') ? -(numDigits * 40 + 40) : -80,
                rotate: (gameState === 'reveal' || gameState === 'result') ? -15 : 0
              }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            >
              <div className="w-16 h-32 bg-[#e0ac69] rounded-r-3xl shadow-lg relative border-r-4 border-black/10">
                {/* Fingers detail */}
                <div className="absolute top-4 right-[-4px] w-6 h-6 bg-[#e0ac69] rounded-full border-r-2 border-black/5" />
                <div className="absolute top-12 right-[-4px] w-6 h-6 bg-[#e0ac69] rounded-full border-r-2 border-black/5" />
                <div className="absolute top-20 right-[-4px] w-6 h-6 bg-[#e0ac69] rounded-full border-r-2 border-black/5" />
                <div className="absolute top-28 right-[-4px] w-6 h-6 bg-[#e0ac69] rounded-full border-r-2 border-black/5" />
              </div>
            </motion.div>

            {/* Paper */}
            <motion.div 
              className="h-32 bg-white shadow-xl border-2 border-slate-200 rounded-sm flex items-center justify-center overflow-hidden relative z-10"
              style={{ width: numDigits * 55 }}
              animate={{ 
                scaleX: (gameState === 'reveal' || gameState === 'result') ? 1 : 0.02,
                opacity: (gameState === 'reveal' || gameState === 'result') ? 1 : 0.9
              }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            >
              <div className="absolute inset-0 bg-[radial-gradient(#e5e7eb_1px,transparent_1px)] [background-size:16px_16px] opacity-30" />
              <AnimatePresence mode="wait">
                {(gameState === 'reveal' || gameState === 'result') && (
                  <motion.span 
                    key="number"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    className="text-5xl font-mono font-bold tracking-widest text-slate-900"
                  >
                    {targetNumber}
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.div>

            {/* Right Hand */}
            <motion.div 
              className="absolute right-1/2 z-20"
              initial={{ x: 80 }}
              animate={{ 
                x: (gameState === 'reveal' || gameState === 'result') ? (numDigits * 40 + 40) : 80,
                rotate: (gameState === 'reveal' || gameState === 'result') ? 15 : 0
              }}
              transition={{ type: 'spring', stiffness: 300, damping: 25 }}
            >
              <div className="w-16 h-32 bg-[#e0ac69] rounded-l-3xl shadow-lg relative border-l-4 border-black/10">
                {/* Fingers detail */}
                <div className="absolute top-4 left-[-4px] w-6 h-6 bg-[#e0ac69] rounded-full border-l-2 border-black/5" />
                <div className="absolute top-12 left-[-4px] w-6 h-6 bg-[#e0ac69] rounded-full border-l-2 border-black/5" />
                <div className="absolute top-20 left-[-4px] w-6 h-6 bg-[#e0ac69] rounded-full border-l-2 border-black/5" />
                <div className="absolute top-28 left-[-4px] w-6 h-6 bg-[#e0ac69] rounded-full border-l-2 border-black/5" />
              </div>
            </motion.div>
          </div>

          {/* Countdown Overlay */}
          <AnimatePresence>
            {gameState === 'countdown' && countdown > 0 && (
              <motion.div 
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1.5, opacity: 1 }}
                exit={{ scale: 2, opacity: 0 }}
                key={countdown}
                className="absolute inset-0 flex items-center justify-center z-30 pointer-events-none"
              >
                <span className="text-8xl font-black text-blue-600 drop-shadow-2xl">
                  {countdown}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

          {/* Game Controls */}
          <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-2xl border border-slate-100 min-h-[440px] sm:min-h-[480px] flex flex-col justify-center relative flex-shrink-0">
            <AnimatePresence mode="wait">
            {gameState === 'idle' && (
              <motion.div 
                key="idle"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="flex flex-col items-center gap-8"
              >
                <div className="text-center space-y-2">
                  <h2 className="text-3xl font-black text-slate-900 uppercase tracking-tighter">Pronto?</h2>
                  <p className="text-slate-500 font-medium">O número aparecerá por apenas <span className="text-blue-600 font-bold">{numDigits === 4 ? '80ms' : numDigits === 5 ? '100ms' : '120ms'}</span>.</p>
                </div>

                <div className="w-full space-y-4">
                  <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 text-center">Quantidade de Números</p>
                  <div className="flex justify-center gap-3">
                    {[4, 5, 6].map((n) => (
                      <button
                        key={n}
                        onClick={() => setNumDigits(n)}
                        className={`w-12 h-12 rounded-2xl font-black transition-all duration-300 ${
                          numDigits === n 
                            ? 'bg-blue-600 text-white shadow-lg shadow-blue-200 scale-110' 
                            : 'bg-slate-100 text-slate-400 hover:bg-slate-200'
                        }`}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </div>

                <button 
                  onClick={startGame}
                  className="group relative w-full flex items-center justify-center gap-3 bg-blue-600 hover:bg-blue-700 text-white px-10 py-5 rounded-3xl font-black text-xl transition-all hover:scale-[1.02] active:scale-95 shadow-xl shadow-blue-100 touch-manipulation"
                >
                  <Play className="fill-current" size={24} />
                  INICIAR JOGO
                </button>
              </motion.div>
            )}

            {gameState === 'countdown' && countdown > 0 && (
              <motion.div 
                key="countdown-text"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-4"
              >
                <p className="text-slate-500 font-bold animate-pulse uppercase tracking-widest">Prepare-se...</p>
              </motion.div>
            )}

            {gameState === 'reveal' && (
              <motion.div 
                key="reveal-text"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-4"
              >
                <p className="text-blue-600 font-black uppercase tracking-widest">Olhe com atenção!</p>
              </motion.div>
            )}

            {(gameState === 'reveal' || gameState === 'input') && (
              <motion.div 
                key="input"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex flex-col items-center gap-6 ${gameState === 'reveal' ? 'opacity-0 pointer-events-none' : ''}`}
              >
                <div className="w-full">
                  <label className="block text-xs font-bold text-slate-400 uppercase tracking-widest mb-2 text-center">
                    O que você viu?
                  </label>
                  <input 
                    ref={inputRef}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={userInput}
                    onChange={handleInputChange}
                    className="w-full text-center text-5xl font-mono font-bold tracking-[0.5em] py-4 border-b-4 border-slate-100 focus:border-blue-500 outline-none transition-colors"
                    placeholder={"-".repeat(numDigits)}
                    maxLength={numDigits}
                    autoFocus
                    autoComplete="off"
                  />
                </div>
                <button 
                  onClick={checkNumber}
                  disabled={userInput.length < numDigits}
                  className="w-full flex items-center justify-center gap-2 bg-slate-900 hover:bg-black disabled:bg-slate-200 text-white py-4 rounded-2xl font-bold transition-all touch-manipulation"
                >
                  <Eye size={20} />
                  CONFERIR NÚMERO
                </button>
              </motion.div>
            )}

            {gameState === 'result' && (
              <motion.div 
                key="result"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex flex-col items-center gap-6"
              >
                <div className={`flex flex-col items-center gap-2 ${isCorrect ? 'text-green-600' : 'text-red-600'}`}>
                  {isCorrect ? (
                    <>
                      <CheckCircle2 size={64} className="mb-2" />
                      <h2 className="text-3xl font-black uppercase">Você acertou!</h2>
                    </>
                  ) : (
                    <>
                      <XCircle size={64} className="mb-2" />
                      <h2 className="text-3xl font-black uppercase">Você errou!</h2>
                    </>
                  )}
                </div>

                <div className="w-full bg-slate-50 p-4 rounded-2xl border border-slate-100 flex justify-between items-center">
                  <div className="text-left">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Sua resposta</span>
                    <div className="flex font-mono font-bold text-xl">
                      {userInput.split('').map((digit, i) => (
                        <span 
                          key={i} 
                          className={digit === targetNumber[i] ? 'text-green-600' : 'text-red-600'}
                        >
                          {digit}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="h-8 w-px bg-slate-200" />
                  <div className="text-right">
                    <span className="text-[10px] font-bold text-slate-400 uppercase block">Número correto</span>
                    <span className="text-xl font-mono font-bold text-blue-600">{targetNumber}</span>
                  </div>
                </div>

                <button 
                  onClick={startGame}
                  className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-4 rounded-2xl font-bold transition-all shadow-lg shadow-blue-100 touch-manipulation"
                >
                  <RotateCcw size={20} />
                  JOGAR NOVAMENTE
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

          <footer className="mt-6 sm:mt-12 text-center">
            <p className="text-slate-400 text-xs font-medium">
              Teste sua memória visual e reflexos.
            </p>
          </footer>
        </div>
      </main>

      {/* History Modal */}
      <AnimatePresence>
        {showHistory && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm"
          >
            <motion.div 
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]"
            >
              <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-10">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-50 rounded-xl text-blue-600">
                    <History size={20} />
                  </div>
                  <h3 className="text-lg font-black uppercase tracking-tight">Histórico de Rodadas</h3>
                </div>
                <button 
                  onClick={() => setShowHistory(false)}
                  className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-slate-600"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-3">
                {history.length === 0 ? (
                  <div className="py-12 text-center">
                    <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
                      <History size={32} />
                    </div>
                    <p className="text-slate-400 font-medium">Nenhuma rodada registrada ainda.</p>
                  </div>
                ) : (
                  history.map((item, idx) => (
                    <div 
                      key={item.timestamp}
                      className="flex items-center justify-between p-4 rounded-2xl border border-slate-100 bg-slate-50/50"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${item.isCorrect ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>
                          {item.isCorrect ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-400 uppercase">Viu:</span>
                            <span className="text-sm font-mono font-bold text-blue-600">{item.target}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-400 uppercase">Digitou:</span>
                            <span className={`text-sm font-mono font-bold ${item.isCorrect ? 'text-slate-600' : 'text-red-400'}`}>{item.user}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] font-bold text-slate-300 uppercase block">
                          {new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
              
              <div className="p-6 bg-slate-50 border-t border-slate-100">
                <button 
                  onClick={() => setShowHistory(false)}
                  className="w-full py-4 bg-slate-900 text-white rounded-2xl font-bold uppercase tracking-widest text-xs hover:bg-black transition-colors"
                >
                  Fechar
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
