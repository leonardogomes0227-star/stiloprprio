import { useEffect, useRef, type ReactNode } from 'react'

export function Sheet({ titulo, onFechar, children }: { titulo: string; onFechar: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null
    const tecla = (e: KeyboardEvent) => e.key === 'Escape' && onFechar()
    document.addEventListener('keydown', tecla)
    document.body.style.overflow = 'hidden'
    ref.current?.querySelector<HTMLElement>('input,textarea,select')?.focus()
    return () => { document.removeEventListener('keydown', tecla); document.body.style.overflow = ''; antes?.focus?.() }
  }, [onFechar])
  return (
    <div className="sheet-fundo" onMouseDown={e => e.target === e.currentTarget && onFechar()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={titulo} ref={ref}>
        <div className="sheet-topo">
          <h2>{titulo}</h2>
          <button className="icone" onClick={onFechar} aria-label="Fechar">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return <label className="campo"><span>{rotulo}</span>{children}</label>
}

export function Filtros<T extends string>({ itens, valor, onChange }: {
  itens: { id: T; nome: string; n: number }[]; valor: T; onChange: (v: T) => void
}) {
  return (
    <div className="filtros" role="tablist">
      {itens.map(f => (
        <button key={f.id} role="tab" aria-selected={valor === f.id} className={'filtro' + (valor === f.id ? ' on' : '')}
          onClick={() => onChange(f.id)}>{f.nome} <b>{f.n}</b></button>
      ))}
    </div>
  )
}

export const Vazio = ({ children }: { children: ReactNode }) => <p className="vazio">{children}</p>
export const Carregando = () => <p className="vazio" role="status">Carregando…</p>

export function Foto({ url, tam = 56 }: { url: string | null | undefined; tam?: number }) {
  return url
    ? <img className="foto" src={url} alt="" width={tam} height={tam} loading="lazy" />
    : <div className="foto vazia" style={{ width: tam, height: tam }} aria-hidden="true">👗</div>
}
