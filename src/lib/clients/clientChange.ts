/** A Client select's change handler; it also clears the Project, which belongs to one Client. */
export const clientChange =
  (setClientId: (id: number) => void, setProjectId: (id: number | null) => void) => (e: { target: { value: string } }) => {
    setClientId(Number(e.target.value));
    setProjectId(null);
  };
