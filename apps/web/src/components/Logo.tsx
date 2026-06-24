// Marca do Collab. O símbolo vive em /public/collab-symbol.svg — basta trocar
// esse arquivo (ex.: pelo export oficial em SVG/PNG) que logo, login e favicon
// se atualizam de uma vez. Mantemos <img> simples por ser um ícone estático.
export function Logo({ size = 30, className }: { size?: number; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/collab-symbol.svg"
      alt="Collab"
      width={size}
      height={size}
      className={className}
      style={{ width: size, height: size, display: 'block' }}
    />
  );
}
