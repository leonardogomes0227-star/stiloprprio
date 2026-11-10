import { useState, type FormEvent } from 'react'
import { demo, supabase } from '../supabase'
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
      {demo && <p className="cartao demo-dica" role="note"><b>Modo demonstração.</b> Entre com qualquer e-mail e senha. Para ver como dona, comece o e-mail com “dona” (ex.: dona@teste). Outros e-mails entram como funcionária.</p>}
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
