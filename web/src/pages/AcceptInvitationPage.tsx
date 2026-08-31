import { type FormEvent, useEffect, useRef, useState } from "react"

import { useAuth } from "../app/auth"
import { ApiError } from "../lib/api"
import { acceptInvitation, registerMember } from "../lib/invitations"

function captureFragmentToken(): string {
  const fragment = window.location.hash.slice(1)
  const params = new URLSearchParams(fragment)
  const token = params.get("token") ?? ""
  window.history.replaceState(
    {},
    "",
    `${window.location.pathname}${window.location.search}`,
  )
  return token
}

export function AcceptInvitationPage() {
  const { refresh } = useAuth()
  const token = useRef("")
  const controller = useRef<AbortController | null>(null)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [email, setEmail] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [busy, setBusy] = useState(false)
  const [complete, setComplete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    token.current = captureFragmentToken()
    setAvailable(Boolean(token.current))
    return () => {
      token.current = ""
      controller.current?.abort()
    }
  }, [])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (password !== confirmation) {
      setError("Passwords must match.")
      return
    }
    const secret = token.current
    token.current = ""
    setBusy(true)
    setError(null)
    controller.current?.abort()
    const request = new AbortController()
    controller.current = request
    try {
      if (secret) {
        await acceptInvitation({
          token: secret,
          email,
          display_name: displayName,
          password,
        }, request.signal)
      } else {
        await registerMember({
          email,
          display_name: displayName,
          password,
        }, request.signal)
      }
      setPassword("")
      setConfirmation("")
      await refresh()
      setComplete(true)
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError")) {
        const message = caught instanceof ApiError
          ? caught.message
          : secret
            ? "The invitation could not be accepted. Open the original link and try again."
            : "The member account could not be created. Try again."
        setError(message)
      }
    } finally {
      if (controller.current === request) controller.current = null
      setBusy(false)
    }
  }

  return (
    <section className="invitation-accept-page">
      <div className="invitation-accept-card">
        <p className="eyebrow">WynterLabs membership</p>
        <h1>Create your account</h1>
        {complete ? (
          <>
            <p className="form-success" role="status">Your member account is ready.</p>
            <a className="button" href="/dashboard">Continue to dashboard</a>
          </>
        ) : (
          <form onSubmit={(event) => void submit(event)}>
            <p>{available ? "Choose your own sign-in details. Your private invitation can be used only once." : "Create a member account for your private card workspace."}</p>
            <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
            <label>Display name<input type="text" minLength={2} maxLength={64} autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label>
            <label>Password<input type="password" minLength={12} maxLength={256} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
            <label>Confirm password<input type="password" minLength={12} maxLength={256} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></label>
            <button type="submit" disabled={busy || available === null}>{busy ? "Creating account" : available ? "Create account" : "Create member account"}</button>
          </form>
        )}
        {error && <p className="form-error" role="alert">{error}</p>}
      </div>
    </section>
  )
}
