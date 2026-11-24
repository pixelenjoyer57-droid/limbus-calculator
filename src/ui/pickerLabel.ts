/** Accessible name of a picker button. It holds every visible word, including the "from the game" badge. */
export const pickerLabel = (label: string, text: string, fromGame: boolean) => `${label}: ${text}${fromGame ? " from the game" : ""}. Change`;
