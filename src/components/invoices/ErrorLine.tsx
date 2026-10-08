export function ErrorLine({ error }: { error: string | null }) {
  return (
    error && (
      <p className="error" role="alert">
        {error}
      </p>
    )
  );
}
