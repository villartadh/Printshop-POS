import React, { useMemo } from 'react';
import { encodeCode128B } from '../../shared/barcodeEncoder.ts';

export interface BarcodeSvgProps {
  value: string;
  height?: number;
  showText?: boolean;
  className?: string;
}

export const BarcodeSvg: React.FC<BarcodeSvgProps> = ({
  value,
  height = 38,
  showText = true,
  className = '',
}) => {
  const encoded = useMemo(() => encodeCode128B(value), [value]);

  return (
    <div className={`inline-flex flex-col items-center w-full bg-white ${className}`}>
      <svg
        role="img"
        aria-label={`Barcode ${encoded.encodedText}`}
        viewBox={`0 0 ${encoded.totalModules} ${height}`}
        preserveAspectRatio="none"
        shapeRendering="crispEdges"
        className="w-full block"
        style={{ height: `${height}px` }}
      >
        <rect x={0} y={0} width={encoded.totalModules} height={height} fill="#ffffff" />
        {encoded.bars.map((bar, idx) => (
          <rect
            key={`${idx}-${bar.x}`}
            x={bar.x}
            y={0}
            width={bar.width}
            height={height}
            fill="#000000"
          />
        ))}
      </svg>
      {showText && (
        <div className="mt-1 text-[10px] leading-none font-mono font-semibold tracking-[0.14em] text-black select-all">
          {encoded.encodedText}
        </div>
      )}
    </div>
  );
};
