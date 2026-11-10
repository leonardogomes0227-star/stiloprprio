import { useState, type FormEvent } from 'react'
import { supabase } from '../supabase'
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
