import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { RefreshCw, CheckCircle2, Info, History as HistoryIcon, X } from 'lucide-react';
import ColorWheel from './components/ColorWheel';
import { RGB, randomRGB, rgbToCss, rgbToLab, deltaE76 } from './utils/color';

interface GameState {
  target: RGB;
  selected: RGB | null;
  distance: number | null;
  history: { target: RGB; selected: RGB; distance: number }[];
}

export default function App() {
  const [state, setState] = useState<GameState>({
    target: randomRGB(),
    selected: null,
    distance: null,
    history: []
  });
  const [showHistory, setShowHistory] = useState(false);

  const startNewRound = useCallback(() => {
    setState(prev => ({
      ...prev,
      target: randomRGB(),
      selected: null,
      distance: null
    }));
  }, []);

  const [wheelSize, setWheelSize] = useState(300);

  useEffect(() => {
    const updateSize = () => {
      const widthSize = window.innerWidth - 48;
      const heightSize = window.innerHeight - 290;
      const size = Math.max(190, Math.min(widthSize, heightSize, 360));
      setWheelSize(size);
    };
    updateSize();
    window.addEventListener('resize', updateSize);
    return () => window.removeEventListener('resize', updateSize);
  }, []);

  const handleColorSelect = (color: RGB) => {
    if (state.selected) return; // Prevent multiple selections in the same round

    const labTarget = rgbToLab(state.target);
    const labSelected = rgbToLab(color);
    const distance = deltaE76(labTarget, labSelected);

    setState(prev => ({
      ...prev,
      selected: color,
      distance,
      history: [{ target: prev.target, selected: color, distance }, ...prev.history].slice(0, 10)
    }));
  };

  const getDistanceLabel = (dist: number) => {
    if (dist < 1.0) return { text: "Perfeito!", color: "text-emerald-500", sub: "Precisão absoluta." };
    if (dist < 3.0) return { text: "Excelente!", color: "text-green-500", sub: "Quase imperceptível." };
    if (dist < 10.0) return { text: "Muito Perto", color: "text-lime-500", sub: "Ótima percepção." };
    if (dist < 20.0) return { text: "Bom", color: "text-yellow-500", sub: "Você está no caminho." };
    if (dist < 40.0) return { text: "Razoável", color: "text-orange-500", sub: "Dá para melhorar." };
    return { text: "Distante", color: "text-red-500", sub: "Tente novamente!" };
  };

  return (
    <div className="h-[100dvh] bg-[#F8F9FA] text-[#1A1A1A] font-sans selection:bg-black selection:text-white overflow-hidden flex flex-col">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md border-b border-gray-100 px-6 py-3 flex justify-between items-center shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-black flex items-center justify-center">
            <div className="w-3 h-3 rounded-full bg-gradient-to-tr from-red-500 via-green-500 to-blue-500" />
          </div>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={() => setShowHistory(true)}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <HistoryIcon size={18} />
          </button>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center p-3 sm:p-4 gap-3 sm:gap-4 relative">
        
        {/* Top Info / Result Area */}
        <div className="w-full max-w-md flex flex-col items-center gap-2 z-30">
          <AnimatePresence mode="wait">
            {state.selected && state.distance !== null ? (
              <motion.div 
                initial={{ y: -20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: -20, opacity: 0 }}
                className="text-center"
              >
                <div className={`text-2xl font-bold ${getDistanceLabel(state.distance).color}`}>
                  {getDistanceLabel(state.distance).text}
                </div>
                <div className="text-sm font-mono opacity-60">
                  Distância: {state.distance.toFixed(1)}
                </div>
              </motion.div>
            ) : (
              <div className="text-center">
                <h2 className="text-[10px] font-mono uppercase tracking-[0.2em] opacity-40">Cor Alvo</h2>
                <p className="text-lg font-light">Encontre esta cor</p>
              </div>
            )}
          </AnimatePresence>
        </div>

        {/* Target Color Circle */}
        <motion.div 
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          key={rgbToCss(state.target)}
          className="w-16 h-16 sm:w-20 sm:h-20 rounded-full shadow-inner border-4 border-white shrink-0 relative"
          style={{ backgroundColor: rgbToCss(state.target) }}
        >
          <div className="absolute inset-0 bg-gradient-to-b from-white/10 to-transparent pointer-events-none" />
        </motion.div>

        {/* Color Wheel */}
        <div className="relative flex-1 flex items-center justify-center w-full max-h-[68dvh]">
          <ColorWheel 
            onSelect={handleColorSelect} 
            size={wheelSize} 
            targetColor={state.selected ? state.target : undefined}
            selectedColor={state.selected}
            disabled={!!state.selected}
          />
        </div>

        {/* Action Button */}
        <div className="w-full max-w-md h-16 flex items-center justify-center shrink-0">
          <AnimatePresence>
            {state.selected && (
              <motion.button 
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                onClick={startNewRound}
                className="px-8 py-3 bg-black text-white rounded-full font-semibold flex items-center justify-center gap-2 hover:bg-gray-800 transition-all active:scale-95 shadow-lg"
              >
                <RefreshCw size={16} />
                Nova Cor
              </motion.button>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* History Drawer */}
      <AnimatePresence>
        {showHistory && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowHistory(false)}
              className="fixed inset-0 bg-black/20 backdrop-blur-sm z-[60]"
            />
            <motion.div 
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className="fixed top-0 right-0 bottom-0 w-full max-w-sm bg-white z-[70] shadow-2xl p-8 overflow-y-auto"
            >
              <div className="flex justify-between items-center mb-10">
                <h3 className="text-xl font-bold">Histórico</h3>
                <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-gray-100 rounded-full">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-6">
                {state.history.length === 0 ? (
                  <p className="text-gray-400 italic text-center py-12">Nenhuma tentativa ainda.</p>
                ) : (
                  state.history.map((item, idx) => (
                    <div key={idx} className="flex items-center gap-4 p-4 rounded-2xl bg-gray-50 border border-gray-100">
                      <div className="flex -space-x-2">
                        <div className="w-10 h-10 rounded-full border-2 border-white shadow-sm" style={{ backgroundColor: rgbToCss(item.target) }} />
                        <div className="w-10 h-10 rounded-full border-2 border-white shadow-sm" style={{ backgroundColor: rgbToCss(item.selected) }} />
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-semibold">{getDistanceLabel(item.distance).text}</div>
                        <div className="text-xs text-gray-400 font-mono">Dist: {item.distance.toFixed(1)}</div>
                      </div>
                      {item.distance < 1.0 && <CheckCircle2 className="text-emerald-500" size={20} />}
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Info Tooltip */}
      <div className="fixed bottom-6 right-6 group hidden sm:block">
        <div className="absolute bottom-full right-0 mb-4 w-64 p-4 bg-white rounded-2xl shadow-xl border border-gray-100 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none text-xs leading-relaxed text-gray-500">
          <p className="font-bold text-black mb-1">Como funciona a distância?</p>
          Utilizamos o algoritmo <strong className="text-black">CIELAB Delta E 76</strong>. Ele calcula a diferença entre cores de forma similar à percepção humana. Quanto menor o número, mais parecidas as cores são.
        </div>
        <button className="w-10 h-10 bg-white shadow-lg border border-gray-100 rounded-full flex items-center justify-center text-gray-400 hover:text-black transition-colors">
          <Info size={20} />
        </button>
      </div>
    </div>
  );
}
