// The "copy this update" text (docs/API.md StaffRequest.copy_update). Nothing is ever sent by the app.

const SENTENCES = {
  new: () => 'We have your report.',
  assigned: () => 'A crew has been assigned.',
  in_progress: () => 'Work has started.',
  done: () => 'The work is done.',
  wont_fix: () => "We won't be fixing this one.",
  merged: targetRef => `It was joined with report ${targetRef}.`
}

export function copyUpdate ({ townName, ref, categoryLabel, locationLabel, status, targetRef, publicMessage, statusUrl }) {
  let text = `${townName}: update on your report ${ref} (${categoryLabel}, ${locationLabel}). ${SENTENCES[status](targetRef)}`
  if (publicMessage) text += ` Message from the town: ${publicMessage}`
  return `${text} Follow it here: ${statusUrl}`
}
