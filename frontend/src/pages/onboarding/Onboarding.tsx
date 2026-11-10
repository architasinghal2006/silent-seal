import { Calculator as CalculatorIcon, Check, EyeOff, FolderLock, KeyRound, MapPin, Mic, ShieldCheck, Siren, Users } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Helplines } from '../../components/Helplines'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { DigitsField, SelectField, TextField } from '../../components/ui/Field'
import { Notice } from '../../components/ui/States'
import { createRecords } from '../../crypto/localUnlock'
import { saveSequence, sequenceProblem } from '../../crypto/sequence'
import { createVault } from '../../crypto/vaultCrypto'
import { locationPermission, requestLocationPermission, type LocationPermission } from '../../geolocation/device'
import { OnboardingLayout } from '../../layouts/OnboardingLayout'
import { api } from '../../services/api'
import { rememberPublicKey, syncAfterUnlock } from '../../services/session'
import type { Channel } from '../../types/api'
import { PIN_PATTERN } from '../../utils/config'
import { setUserId } from '../../utils/storage'
import { EMAIL_PATTERN, PHONE_PATTERN, passphraseProblem } from '../../utils/validation'

type Step = 'welcome' | 'model' | 'sequence' | 'pins' | 'contact' | 'passphrase' | 'permissions' | 'finish' | 'restore'

const ORDER: Step[] = ['welcome', 'model', 'sequence', 'pins', 'contact', 'passphrase', 'permissions', 'finish']

function Art({ children, tone = 'pink' }: { children: ReactNode; tone?: 'pink' | 'mint' }) {
  return (
    <span className={`grid size-28 place-items-center rounded-full ${tone === 'pink' ? 'bg-white text-pink-ink' : 'bg-mint text-green-ink'} shadow-card`}>
      {children}
    </span>
  )
}

function Point({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <li className="flex gap-4">
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-blush text-pink-ink" aria-hidden="true">
        {icon}
      </span>
      <span>
        <span className="block font-semibold">{title}</span>
        <span className="block text-[15px] text-soft">{children}</span>
      </span>
    </li>
  )
}

/**
 * First-time setup. Reached from the calculator with the starting sequence when this phone
 * has no account. Creates the account, then walks through the pieces one screen at a time.
 */
export default function Onboarding({ onDone, onExit }: { onDone: () => void; onExit: () => void }) {
  const [step, setStep] = useState<Step>('welcome')
  const [sequence, setSequence] = useState('')
  const [realPin, setRealPin] = useState('')
  const [duressPin, setDuressPin] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Trusted contact
  const [alertName, setAlertName] = useState('')
  const [contactName, setContactName] = useState('')
  const [relationship, setRelationship] = useState('')
  const [channel, setChannel] = useState<Channel>('sms')
  const [destination, setDestination] = useState('')
  const [contactSaved, setContactSaved] = useState(false)

  // Evidence passphrase
  const [passphrase, setPassphrase] = useState('')
  const [confirm, setConfirm] = useState('')
  const [vaultMade, setVaultMade] = useState(false)

  // Permissions
  const [location, setLocation] = useState<LocationPermission>('prompt')

  // Restore
  const [restoreCode, setRestoreCode] = useState('')
  const [restorePin, setRestorePin] = useState('')
  const [restored, setRestored] = useState(false)

  const index = ORDER.indexOf(step)
  const go = (next: Step) => {
    setError('')
    setStep(next)
  }
  // Once the account exists, going back past that point would only confuse.
  const back = index > 0 && index <= ORDER.indexOf('pins') ? () => go(ORDER[index - 1]) : undefined

  function submitSequence(e: FormEvent) {
    e.preventDefault()
    const problem = sequenceProblem(sequence)
    if (problem) return setError(problem)
    go('pins')
  }

  async function submitPins(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!PIN_PATTERN.test(realPin) || !PIN_PATTERN.test(duressPin)) return setError('Each PIN must be 4 to 8 digits.')
    if (realPin === duressPin) return setError('The two PINs must be different.')
    if ([realPin, duressPin].includes(sequence)) return setError('Choose PINs that are different from your secret sequence.')
    setBusy(true)
    try {
      const reply = await api.setup(realPin, duressPin)
      await createRecords(realPin, reply.offline_real, duressPin, reply.offline_duress)
      setUserId(reply.user_id)
      await saveSequence(sequence)
      setRecoveryCode(reply.user_id)
      // Asks the browser not to clear this data when space runs low. No prompt on most phones.
      void navigator.storage?.persist?.().catch(() => undefined)
      // The remaining steps save to the new account, so open a session for them.
      if ((await api.unlock(reply.user_id, realPin)) !== 'ok') throw new Error('unlock failed')
      void syncAfterUnlock(realPin).catch(() => undefined)
      void locationPermission().then(setLocation)
      go('contact')
    } catch {
      setError('Could not reach the server, so nothing was set up. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  async function submitContact(e: FormEvent) {
    e.preventDefault()
    setError('')
    if (!contactName.trim()) return setError('Enter their name.')
    if (channel === 'sms' && !PHONE_PATTERN.test(destination)) return setError('Enter a phone number with country code, like +919800000001.')
    if (channel === 'email' && !EMAIL_PATTERN.test(destination)) return setError('Enter an email address.')
    setBusy(true)
    try {
      if (alertName.trim()) await api.saveProfile(alertName.trim())
      await api.createContact({
        name: contactName.trim(),
        relationship: relationship.trim(),
        channel,
        phone: channel === 'sms' ? destination : null,
        email: channel === 'email' ? destination : null,
        is_emergency: true,
      })
      setContactSaved(true)
      go('passphrase')
    } catch {
      setError('Could not save this contact. Check your connection and try again, or skip and add them later.')
    } finally {
      setBusy(false)
    }
  }

  async function submitPassphrase(e: FormEvent) {
    e.preventDefault()
    const problem = passphraseProblem(passphrase, confirm)
    if (problem) return setError(problem)
    setBusy(true)
    setError('')
    try {
      const { meta } = await createVault(passphrase)
      await api.createVaultMeta(meta)
      void rememberPublicKey(meta.public_key).catch(() => undefined)
      setVaultMade(true)
      setPassphrase('')
      setConfirm('')
      go('permissions')
    } catch {
      setError('Could not set up the vault. Check your connection and try again, or skip and set it up later.')
    } finally {
      setBusy(false)
    }
  }

  async function submitRestore(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError('')
    const code = restoreCode.trim()
    const result = await api.unlock(code, restorePin)
    if (result === 'ok') {
      setUserId(code)
      void syncAfterUnlock(restorePin).catch(() => undefined)
      setRestored(true)
      setBusy(false)
      return go('finish')
    }
    setBusy(false)
    setError(
      result === 'offline'
        ? 'Restoring needs a connection. Try again when you are online.'
        : "That code and PIN don't match. If you tried several times, wait a minute and try again.",
    )
  }

  const steps = ORDER.length
  const errorNotice = error && <Notice tone="danger">{error}</Notice>

  if (step === 'welcome') {
    return (
      <OnboardingLayout
        step={1}
        steps={steps}
        onExit={onExit}
        art={<Art><ShieldCheck size={52} strokeWidth={1.6} /></Art>}
        title="A private way to ask for help."
        lede="Silent Seal stays hidden behind this calculator. Only you can open it, and nothing is shared unless you choose."
        footer={
          <>
            <Button size="lg" block onClick={() => go('model')}>
              Get started
            </Button>
            <Button variant="ghost" block onClick={() => go('restore')}>
              I have a recovery code
            </Button>
          </>
        }
      >
        <Card>
          <ul className="grid gap-5">
            <Point icon={<Siren size={20} />} title="Silent SOS">
              Hold one button and the people you trust get your location. Nothing shows on this phone.
            </Point>
            <Point icon={<FolderLock size={20} />} title="Encrypted evidence">
              Notes, photos and audio are locked on this phone before they are stored.
            </Point>
            <Point icon={<Users size={20} />} title="You stay in control">
              You pick who is told, and you can leave any screen in one tap.
            </Point>
          </ul>
        </Card>
      </OnboardingLayout>
    )
  }

  if (step === 'model') {
    return (
      <OnboardingLayout
        step={2}
        steps={steps}
        onBack={back}
        onExit={onExit}
        art={<Art><EyeOff size={50} strokeWidth={1.6} /></Art>}
        title="How it keeps this private"
        lede="Built for a phone that someone else may pick up, check, or make you unlock."
        footer={
          <Button size="lg" block onClick={() => go('sequence')}>
            Next
          </Button>
        }
      >
        <Card>
          <ul className="grid gap-5">
            <Point icon={<CalculatorIcon size={20} />} title="It looks like a calculator">
              It installs as “Calculator” and works as one. A secret sequence you choose reveals where to type your PIN.
            </Point>
            <Point icon={<KeyRound size={20} />} title="Two PINs">
              Your PIN opens the app. A second, duress PIN opens an empty-looking app and silently alerts your contacts, for when you are forced to unlock.
            </Point>
            <Point icon={<ShieldCheck size={20} />} title="Quick exit, always">
              The Exit button, the Esc key, switching apps or five quiet minutes all return to the calculator.
            </Point>
          </ul>
        </Card>
        <Card tone="flat">
          <h2 className="font-semibold">What it can’t do</h2>
          <ul className="mt-2 grid list-disc gap-1.5 pl-5 text-[15px] text-soft">
            <li>It can’t guarantee your safety, and it doesn’t replace emergency services.</li>
            <li>It isn’t invisible: someone who knows what to look for could find that it is installed.</li>
            <li>Alerts and live location only work while this app is open and the phone is on.</li>
          </ul>
        </Card>
      </OnboardingLayout>
    )
  }

  if (step === 'sequence') {
    return (
      <form onSubmit={submitSequence}>
        <OnboardingLayout
          step={3}
          steps={steps}
          onBack={back}
          onExit={onExit}
          art={<Art><CalculatorIcon size={50} strokeWidth={1.6} /></Art>}
          title="Choose your secret sequence"
          lede="Typing this on the calculator and pressing = is how you get to the PIN. To anyone else it is just a sum."
          footer={
            <Button type="submit" size="lg" block>
              Next
            </Button>
          }
        >
          <Card className="grid gap-4">
            <DigitsField
              label="Secret sequence"
              value={sequence}
              onValue={setSequence}
              autoFocus
              hint="4 to 8 digits. Pick something you won’t type by accident, and different from your PINs."
            />
            {errorNotice}
          </Card>
        </OnboardingLayout>
      </form>
    )
  }

  if (step === 'pins') {
    return (
      <form onSubmit={submitPins}>
        <OnboardingLayout
          step={4}
          steps={steps}
          onBack={back}
          onExit={onExit}
          art={<Art><KeyRound size={50} strokeWidth={1.6} /></Art>}
          title="Set your two PINs"
          lede="Both look the same from outside. Only you know which is which."
          footer={
            <Button type="submit" size="lg" block loading={busy}>
              {busy ? 'Setting up…' : 'Create my account'}
            </Button>
          }
        >
          <Card className="grid gap-4">
            <DigitsField label="Your PIN" value={realPin} onValue={setRealPin} autoFocus hint="Opens your real app. 4 to 8 digits." />
            <DigitsField
              label="Duress PIN"
              value={duressPin}
              onValue={setDuressPin}
              hint="For when you are forced to unlock. It opens an empty app and silently sends an SOS to your trusted contacts."
            />
            {errorNotice}
          </Card>
          <p className="px-1 text-sm text-soft">A wrong PIN just shows the number, like any sum. After five wrong tries, unlocking pauses for a minute.</p>
        </OnboardingLayout>
      </form>
    )
  }

  if (step === 'contact') {
    return (
      <form onSubmit={submitContact}>
        <OnboardingLayout
          step={5}
          steps={steps}
          onExit={onExit}
          onSkip={() => go('passphrase')}
          art={<Art><Users size={50} strokeWidth={1.6} /></Art>}
          title="Who should be told?"
          lede="A trusted contact gets your alerts and a private live map. Choose someone who knows your situation."
          footer={
            <Button type="submit" size="lg" block loading={busy}>
              {busy ? 'Saving…' : 'Save contact'}
            </Button>
          }
        >
          <Card className="grid gap-4">
            <TextField label="Your name in alerts" value={alertName} maxLength={80} onChange={(e) => setAlertName(e.target.value)} hint="So they know who needs help." />
            <TextField label="Their name" value={contactName} maxLength={80} onChange={(e) => setContactName(e.target.value)} />
            <TextField label="Relationship" value={relationship} maxLength={40} onChange={(e) => setRelationship(e.target.value)} placeholder="Sister, friend, counsellor…" />
            <SelectField
              label="Send alerts by"
              value={channel}
              onChange={(e) => {
                setChannel(e.target.value as Channel)
                setDestination('')
              }}
            >
              <option value="sms">SMS</option>
              <option value="email">Email</option>
            </SelectField>
            {channel === 'sms' ? (
              <TextField label="Phone number" type="tel" inputMode="tel" value={destination} onChange={(e) => setDestination(e.target.value.replace(/[\s-]/g, ''))} placeholder="+919800000001" />
            ) : (
              <TextField label="Email address" type="email" inputMode="email" value={destination} onChange={(e) => setDestination(e.target.value.trim())} />
            )}
            {errorNotice}
          </Card>
          <p className="px-1 text-sm text-soft">Ask them not to call or text you back after an alert: a reply on your phone could put you at risk.</p>
        </OnboardingLayout>
      </form>
    )
  }

  if (step === 'passphrase') {
    return (
      <form onSubmit={submitPassphrase}>
        <OnboardingLayout
          step={6}
          steps={steps}
          onExit={onExit}
          onSkip={() => go('permissions')}
          art={<Art><FolderLock size={50} strokeWidth={1.6} /></Art>}
          title="Lock your evidence vault"
          lede="A passphrase, separate from your PIN, encrypts your notes, photos and audio on this phone before they are stored."
          footer={
            <Button type="submit" size="lg" block loading={busy}>
              {busy ? 'Creating your vault…' : 'Create vault'}
            </Button>
          }
        >
          <Card className="grid gap-4">
            <TextField label="Passphrase" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} hint="A few words you’ll remember works well. At least 10 characters, not only numbers." />
            <TextField label="Type it again" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            {errorNotice}
          </Card>
          <Notice tone="warn">Nobody can reset this passphrase, including us. If you forget it, your evidence cannot be opened.</Notice>
        </OnboardingLayout>
      </form>
    )
  }

  if (step === 'permissions') {
    return (
      <OnboardingLayout
        step={7}
        steps={steps}
        onExit={onExit}
        art={<Art tone="mint"><MapPin size={50} strokeWidth={1.6} /></Art>}
        title="Permissions, and why"
        lede="Nothing is used until you act. You can change these any time in your browser’s site settings."
        footer={
          <Button size="lg" block onClick={() => go('finish')}>
            Next
          </Button>
        }
      >
        <Card className="grid gap-4">
          <div className="flex items-start gap-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-mint-soft text-green-ink" aria-hidden="true">
              <MapPin size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="font-semibold">Location</h2>
              <p className="text-[15px] text-soft">
                Lets an alert say where you are and draws your live map. It is sent only during an alert or a share you start.
              </p>
              <div className="mt-3">
                {location === 'granted' ? (
                  <span className="inline-flex items-center gap-2 font-semibold text-green-ink">
                    <Check size={18} aria-hidden="true" /> Location is allowed
                  </span>
                ) : location === 'denied' ? (
                  <p className="text-sm font-medium text-amber-ink">Location is blocked in your browser. Alerts will still send, without your location.</p>
                ) : location === 'unsupported' ? (
                  <p className="text-sm font-medium text-amber-ink">This browser can’t share location.</p>
                ) : (
                  <Button variant="safe" size="sm" onClick={() => void requestLocationPermission().then(setLocation)}>
                    Allow location
                  </Button>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-start gap-4 border-t border-line pt-4">
            <span className="grid size-11 shrink-0 place-items-center rounded-full bg-mint-soft text-green-ink" aria-hidden="true">
              <Mic size={20} />
            </span>
            <div>
              <h2 className="font-semibold">Microphone and photos</h2>
              <p className="text-[15px] text-soft">Asked for only when you record audio or add a photo in the vault.</p>
            </div>
          </div>
        </Card>
        <p className="px-1 text-sm text-soft">
          Allow location now if you want it: an alert never shows a permission prompt, because a prompt in an emergency could be seen.
        </p>
      </OnboardingLayout>
    )
  }

  if (step === 'restore') {
    return (
      <form onSubmit={submitRestore}>
        <OnboardingLayout
          step={1}
          steps={steps}
          onBack={() => go('welcome')}
          onExit={onExit}
          art={<Art><KeyRound size={50} strokeWidth={1.6} /></Art>}
          title="Use a recovery code"
          lede="Reconnects this phone to an account you already have, with its contacts and evidence."
          footer={
            <Button type="submit" size="lg" block loading={busy}>
              {busy ? 'Checking…' : 'Restore'}
            </Button>
          }
        >
          <Card className="grid gap-4">
            <TextField label="Recovery code" value={restoreCode} spellCheck={false} onChange={(e) => setRestoreCode(e.target.value)} />
            <DigitsField label="Your PIN" value={restorePin} onValue={setRestorePin} />
            {errorNotice}
          </Card>
        </OnboardingLayout>
      </form>
    )
  }

  // finish
  return (
    <OnboardingLayout
      step={steps}
      steps={steps}
      onExit={onExit}
      art={<Art tone="mint"><Check size={56} strokeWidth={1.8} /></Art>}
      title={restored ? 'This phone is connected' : 'You’re set up'}
      lede="Here is how to get back in, and where to turn in an emergency."
      footer={
        <Button size="lg" block onClick={onDone}>
          Go to the calculator
        </Button>
      }
    >
      <Card>
        <h2 className="font-semibold">To open this app</h2>
        <ol className="mt-2 grid list-decimal gap-1.5 pl-5 text-[15px]">
          <li>
            On the calculator, type your secret sequence and press <strong>=</strong>
          </li>
          <li>
            Type your PIN and press <strong>=</strong>
          </li>
        </ol>
        {restored && <p className="mt-3 text-sm text-soft">This phone uses the starting sequence until you choose your own in Settings.</p>}
      </Card>

      {!restored && (
        <Card>
          <h2 className="font-semibold">Your setup</h2>
          <ul className="mt-2 grid gap-2 text-[15px]">
            <SetupLine done label="Secret sequence and both PINs" />
            <SetupLine done={contactSaved} label="Trusted contact" pending="Add one in Contacts so alerts reach someone" />
            <SetupLine done={vaultMade} label="Evidence vault" pending="Set it up in Vault when you’re ready" />
            <SetupLine done={location === 'granted'} label="Location" pending="Off: alerts won’t say where you are" />
          </ul>
        </Card>
      )}

      {recoveryCode && (
        <Card>
          <h2 className="font-semibold">Your recovery code</h2>
          <p className="mt-2 select-all break-all rounded-control bg-bg px-4 py-3 font-mono text-sm">{recoveryCode}</p>
          <p className="mt-2 text-sm text-soft">
            With this and your PIN you can reach your evidence from any phone, even after wiping this one. Keep it away from this phone, or with
            someone you trust. You can see it again in Settings.
          </p>
        </Card>
      )}

      <Helplines />
    </OnboardingLayout>
  )
}

function SetupLine({ done, label, pending }: { done: boolean; label: string; pending?: string }) {
  return (
    <li className="flex items-start gap-3">
      <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full ${done ? 'bg-green text-white' : 'bg-line text-soft'}`} aria-hidden="true">
        {done && <Check size={14} strokeWidth={3} />}
      </span>
      <span>
        <span className="font-medium">{label}</span>
        <span className="sr-only">{done ? ': done' : ': not done'}</span>
        {!done && pending && <span className="block text-sm text-soft">{pending}</span>}
      </span>
    </li>
  )
}
