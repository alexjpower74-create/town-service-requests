// History entry texts (docs/API.md "History entries"). Each entry is stored with its staff text, its public text (null when
// internal) and the internal flag, so the public status query can select public_text alone and never touch staff text.

const STATUS_TEXT = {
  new: 'Reopened',
  assigned: { public: 'Assigned to a crew', staff: 'Assigned' },
  in_progress: 'Work started',
  done: 'Marked done',
  wont_fix: 'Closed without a fix'
}

const entry = (kind, publicText, staffText) => ({ kind, public_text: publicText, staff_text: staffText, internal: publicText === null ? 1 : 0 })

export const created = () => entry('created', 'Reported', 'Reported')
export const meToo = () => entry('me_too', 'Someone else reported it too', 'Someone else reported it too (+1)')

export function status (to) {
  const t = STATUS_TEXT[to]
  return typeof t === 'string' ? entry('status', t, t) : entry('status', t.public, t.staff)
}

export const crew = crewName => entry('crew', null, crewName === null ? 'Crew removed' : `Crew: ${crewName}`)

export const message = text => (text === null
  ? entry('message', null, 'Public message removed')
  : entry('message', `Message from the town: ${text}`, `Public message: ${text}`))

export const note = text => entry('note', null, text)
export const photo = () => entry('photo', null, 'Photo added')

export const mergedIn = (sourceRef, added) =>
  entry('merged_in', 'Another report of the same problem was joined to this one', `Joined in ${sourceRef} (+${added})`)
export const mergedInto = targetRef => entry('merged_into', `Joined with ${targetRef}`, `Joined with ${targetRef}`)
