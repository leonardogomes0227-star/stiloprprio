import { useState, type FormEvent } from 'react'
import { entrarTeste, modoTeste, supabase, temDadosTeste } from '../supabase'
import { msgErro } from '../lib'
import { Campo } from '../ui'

export default function Login() {
  const [email, setEmail] = useState('')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [indo, setIndo] = useState(false)

  async function entrar(e: FormEvent) {
    e.preventDefault()
    setErro(''); setIndo(true)
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha })
      if (error) throw error
    } catch (x) { setErro(msgErro(x)) }
    finally { setIndo(false) }
  }

  if (modoTeste) return (
    <main className="tela-login">
      <p className="faixa-teste" role="note">MODO TESTE: dados só neste aparelho</p>
      <h1>Condicional</h1>
      <p className="sub">Quem está com qual peça, sem papel e sem confusão.</p>
      <div className="cartao">
        <button className="btn grande" onClick={() => entrarTeste('exemplo')}>Entrar com dados de exemplo</button>
        <button className="btn claro grande" onClick={() => entrarTeste('vazio')}>Entrar vazio</button>
        {temDadosTeste() && <button className="link" onClick={() => entrarTeste('continuar')}>Continuar com os dados que eu já tinha</button>}
      </div>
    </main>
  )

  return (
    <main className="tela-login">
      <h1>Condicional</h1>
      <p className="sub">Quem está com qual peça, sem papel e sem confusão.</p>
      <form className="cartao" onSubmit={entrar}>
        <Campo rotulo="E-mail">
          <input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)} />
        </Campo>
        <Campo rotulo="Senha">
          <input type="password" autoComplete="current-password" required value={senha} onChange={e => setSenha(e.target.value)} />
        </Campo>
        {erro && <p className="erro-form" role="alert">{erro}</p>}
        <button className="btn grande" disabled={indo}>{indo ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </main>
  )
}
