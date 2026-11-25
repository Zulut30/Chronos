import { useLocale } from "gt-react";
import { useState } from "react";
import { trello } from "../../../../../chronos/l10n/gt-additions.json";
import { Button } from "../../components/ui/button";
import { SecretInput } from "../../components/settings/SecretInput";

export function useTrelloCopy() {
  const locale = useLocale();
  return (source: keyof typeof trello) => (locale.startsWith("ru") ? trello[source] : source);
}

export function TrelloCredentials({
  id,
  submit,
}: {
  id: string;
  submit: (value: string) => Promise<boolean>;
}) {
  const t = useTrelloCopy();
  const [key, setKey] = useState("");
  const [token, setToken] = useState("");
  const save = async () => {
    if (await submit(key.trim() + ":" + token.trim())) {
      setKey("");
      setToken("");
    }
  };
  return (
    <div className="grid w-full min-w-0 gap-2">
      <SecretInput
        id={id}
        size="sm"
        aria-label={t("API key")}
        placeholder={t("API key")}
        value={key}
        onChange={(e) => setKey(e.target.value)}
      />
      <SecretInput
        size="sm"
        aria-label={t("Personal token")}
        placeholder={t("Personal token")}
        value={token}
        onChange={(e) => setToken(e.target.value)}
      />
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={!key.trim() || !token.trim()}
        onClick={() => void save()}
      >
        {t("Connect Trello")}
      </Button>
    </div>
  );
}
