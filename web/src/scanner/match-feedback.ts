export function scanMatchFeedback(candidateCount: number, hasSelection: boolean) {
  if (candidateCount <= 0) return "No confident printing found. Correct the title or retake the card.";
  if (hasSelection && candidateCount === 1) {
    return "1 confident printing found and preselected. Confirm the printing and collection details.";
  }
  if (hasSelection) {
    return `${candidateCount} possible printings found. The best match is preselected; verify the set and collector number.`;
  }
  return `${candidateCount} possible printings found. Choose the exact set and collector number.`;
}
