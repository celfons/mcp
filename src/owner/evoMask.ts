/**
 * Máscara de dado pessoal nas respostas cruas da EVO (ferramentas `evo_v*_*`
 * da gestão).
 *
 * A regra é por NOME DE CAMPO, aplicada em toda a árvore da resposta, porque as
 * 81 rotas devolvem formatos diferentes e um formato novo da EVO não pode
 * vazar por não ter sido previsto rota a rota:
 *
 * - **removido**: segredo ou dado sensível que não tem forma mascarada útil
 *   (foto, cartão, token, senha, assinatura, QR de acesso).
 * - **nome de aluno/lead/responsável** → iniciais (`Maria Silva` → `M. S.`).
 *   O `name` genérico só é mascarado quando o objeto é de uma PESSOA (tem
 *   `idMember`, `idProspect`, e-mail, CPF…): `name` de plano, aula ou unidade
 *   segue legível. Nome de FUNCIONÁRIO (vendedor, professor) segue legível em
 *   campo próprio — é dado de gestão da academia, como já era em `evo_gestao_*`.
 * - **contato e documento** → só os 2 últimos caracteres.
 * - **endereço** → removido; **nascimento** → só o ano.
 *
 * Texto livre (observações) não é varrido: a regra não lê conteúdo, só chaves.
 */

const norm = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");

const REMOVED = new Set(
  [
    "photo", "foto", "photourl", "urlphoto", "urlfotomobile", "photofront", "photoback", "photoleftside",
    "photorightside", "fotoprofessor", "instructorphoto", "image", "imagebase64", "facialphoto",
    "carddata", "cardnumber", "truncatedcardnumber", "accesscardnumber", "cardexpirationmonth",
    "cardexpirationyear", "cvv", "securitycode", "idcreditcard",
    "token", "tokenauth", "chargetoken", "transactiontoken", "temporarytoken", "formtoken", "branchtoken",
    "idbranchtoken", "idclientetoken", "idmembertoken", "idprospecttoken", "idmembercardtoken",
    "idmembershiptoken", "tokengympass", "tokenrecorrencia", "usertokengogood", "tokenfacilitador",
    "apikey", "secretkey", "keycliente", "keyprospect", "password", "senha", "urlresetpassword",
    "signature", "accesscontrolqrcode", "qrcode", "chaveqrcode", "linkqrcode", "headers", "authorization",
    "address", "streetaddress", "addresslocation", "street", "logradouro", "endereco", "complement",
    "complemento", "neighborhood", "bairro", "zipcode", "cep", "postalcode", "latitude", "longitude"
  ].map(norm)
);

/** Nome de pessoa (aluno, lead, responsável, pagador) — vira iniciais. */
const PERSON_NAME = new Set(
  [
    "firstname", "lastname", "registername", "registerlastname", "membername", "namemember", "nameprospect",
    "prospectname", "clientname", "nomecliente", "responsiblename", "payername", "cardholder", "cardholdername",
    "nomecompleto", "sobrenome", "socialname", "preferredname", "displayname", "whatsappusername",
    "namememberpersonaltrainer", "nameresponsible", "buyername"
  ].map(norm)
);

/** Contato e documento — só os 2 últimos caracteres. */
const PARTIAL = new Set(
  [
    "email", "businessemail", "buyeremail", "currentemail", "financialemail", "marketingemail", "emailtruncate",
    "cellphone", "phone", "telephone", "telefone", "celular", "additionalphone", "mobile", "whatsapp",
    "cpf", "rg", "document", "documentid", "memberdocument", "cpfresponsible", "passport", "cpfcnpj",
    "documento", "nationalid"
  ].map(norm)
);

const BIRTH = new Set(["birthdate", "birthday", "dtnascimento", "datanascimento", "nascimento"].map(norm));

/** Sub-árvores inteiras de contato (lista de telefones/e-mails do aluno). */
const CONTACT_TREE = new Set(["contacts", "contact", "contatos", "phones", "emails"].map(norm));

/** Marcas de que o objeto é uma PESSOA — aí o `name` genérico também é dela. */
const PERSON_MARKERS = new Set(
  [
    "idmember", "idprospect", "idresponsible", "idmemberresponsible", "idclient", "idcliente",
    "email", "cpf", "document", "cellphone", "birthdate", "firstname", "lastname", "registername", "gender"
  ].map(norm)
);
const GENERIC_NAME = new Set(["name", "nome", "fullname"].map(norm));

const MASK = "***";

export function initials(value: string): string {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts.map((p) => `${p[0].toUpperCase()}.`).join(" ") : MASK;
}

export function partial(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  return text.length <= 4 ? MASK : `${MASK}${text.slice(-2)}`;
}

function maskAll(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskAll);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, /type|tipo|^id/i.test(k) ? v : maskAll(v)])
    );
  }
  return value === null || value === undefined || typeof value === "boolean" ? value : partial(value);
}

export function maskPersonalData(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskPersonalData);
  if (!value || typeof value !== "object") return value;

  const entries = Object.entries(value as Record<string, unknown>);
  const isPerson = entries.some(([k, v]) => PERSON_MARKERS.has(norm(k)) && v !== null && v !== undefined && v !== "");
  const out: Record<string, unknown> = {};
  for (const [key, v] of entries) {
    const k = norm(key);
    if (REMOVED.has(k)) {
      if (v !== null && v !== undefined && v !== "") out[key] = "[removido]";
      else out[key] = v;
    } else if (CONTACT_TREE.has(k)) {
      out[key] = maskAll(v);
    } else if (typeof v === "string" && (PERSON_NAME.has(k) || (isPerson && GENERIC_NAME.has(k)))) {
      out[key] = initials(v);
    } else if (PARTIAL.has(k) && v !== null && v !== undefined && typeof v !== "object") {
      out[key] = partial(v);
    } else if (BIRTH.has(k) && typeof v === "string") {
      out[key] = /^\d{4}/.test(v) ? `${v.slice(0, 4)}-**-**` : MASK;
    } else {
      out[key] = maskPersonalData(v);
    }
  }
  return out;
}
