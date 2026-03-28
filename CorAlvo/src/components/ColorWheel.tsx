import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import { RGB, hslToRgb, rgbToHsl } from '../utils/color';

interface ColorWheelProps {
  onSelect: (color: RGB) => void;
  size?: number;
  targetColor?: RGB;
  selectedColor?: RGB | null;
  disabled?: boolean;
}

const ColorWheel: React.FC<ColorWheelProps> = ({ onSelect, size = 300, targetColor, selectedColor, disabled = false }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lightness = 50; // Fixed lightness
  const [isDragging, setIsDragging] = useState(false);

  const drawWheel = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const radius = size / 2;
    const centerX = radius;
    const centerY = radius;

    ctx.clearRect(0, 0, size, size);

    const imageData = ctx.createImageData(size, size);
    const data = imageData.data;

    for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
        const dx = x - centerX;
        const dy = y - centerY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist <= radius) {
          const angle = Math.atan2(dy, dx);
          const hue = (angle + Math.PI) / (2 * Math.PI) * 360;
          const saturation = (dist / radius) * 100;
          
          const rgb = hslToRgb(hue, saturation, lightness);
          
          const index = (y * size + x) * 4;
          data[index] = rgb.r;
          data[index + 1] = rgb.g;
          data[index + 2] = rgb.b;
          data[index + 3] = 255;
        }
      }
    }
    ctx.putImageData(imageData, 0, 0);

    ctx.beginPath();
    ctx.arc(centerX, centerY, radius - 1, 0, 2 * Math.PI);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [size, lightness]);

  useEffect(() => {
    drawWheel();
  }, [drawWheel]);

  const getPosFromColor = useCallback((color: RGB) => {
    const { h, s } = rgbToHsl(color.r, color.g, color.b);
    const radius = size / 2;
    const angle = (h / 360) * (2 * Math.PI) - Math.PI;
    const dist = (s / 100) * radius;
    return {
      x: radius + dist * Math.cos(angle),
      y: radius + dist * Math.sin(angle)
    };
  }, [size]);

  const targetPos = useMemo(() => targetColor ? getPosFromColor(targetColor) : null, [targetColor, getPosFromColor]);
  const selectedPos = useMemo(() => selectedColor ? getPosFromColor(selectedColor) : null, [selectedColor, getPosFromColor]);

  const handleInteraction = (e: React.MouseEvent | React.TouchEvent) => {
    if (disabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    let clientX, clientY;

    if ('touches' in e) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    const x = clientX - rect.left;
    const y = clientY - rect.top;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const pixel = ctx.getImageData(x, y, 1, 1).data;
    
    if (pixel[3] > 0) {
      onSelect({
        r: pixel[0],
        g: pixel[1],
        b: pixel[2]
      });
    }
  };

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-md relative">
      <div 
        className="relative cursor-crosshair touch-none select-none"
        onMouseDown={() => setIsDragging(true)}
        onMouseUp={() => setIsDragging(false)}
        onMouseLeave={() => setIsDragging(false)}
        onMouseMove={(e) => isDragging && handleInteraction(e)}
        onClick={handleInteraction}
        onTouchStart={(e) => {
          setIsDragging(true);
          handleInteraction(e);
        }}
        onTouchMove={(e) => isDragging && handleInteraction(e)}
        onTouchEnd={() => setIsDragging(false)}
      >
        <canvas 
          ref={canvasRef} 
          width={size} 
          height={size} 
          className="rounded-full shadow-2xl bg-transparent"
        />

        {/* Markers */}
        {selectedPos && (
          <>
            {/* Line from selected to target */}
            {targetPos && (
              <svg className="absolute inset-0 pointer-events-none" width={size} height={size}>
                <line 
                  x1={selectedPos.x} y1={selectedPos.y} 
                  x2={targetPos.x} y2={targetPos.y} 
                  stroke="white" 
                  strokeWidth="2" 
                  strokeDasharray="4 2"
                  className="opacity-50"
                />
              </svg>
            )}
            
            {/* Selected Marker */}
            <div 
              className="absolute w-6 h-6 border-2 border-white rounded-full shadow-lg pointer-events-none -translate-x-1/2 -translate-y-1/2 z-10"
              style={{ left: selectedPos.x, top: selectedPos.y }}
            />
            
            {/* Target Marker (only shown after selection) */}
            {targetPos && (
              <div 
                className="absolute w-6 h-6 border-2 border-black bg-white/50 rounded-full shadow-lg pointer-events-none -translate-x-1/2 -translate-y-1/2 z-20 flex items-center justify-center"
                style={{ left: targetPos.x, top: targetPos.y }}
              >
                <div className="w-2 h-2 bg-black rounded-full" />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ColorWheel;
