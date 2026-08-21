// Data de coluna DATE virando "AAAA-MM-DD" pro frontend.
//
// node-postgres converte coluna DATE num objeto Date, não numa string. E
// `String(date)` produz "Fri Aug 21 2026 00:00:00 GMT-0300", então cortar 10
// caracteres disso dá "Fri Aug 21" — foi exatamente o que apareceu na tela de
// pedidos, no lugar de 21/08/2026.
//
// Usa os getters LOCAIS de propósito, não toISOString(): o parser do pg monta
// a data com `new Date(ano, mes - 1, dia)`, que é meia-noite no fuso do
// servidor. Converter isso pra UTC num fuso negativo joga a data um dia pra
// trás. getFullYear/getMonth/getDate devolvem exatamente o dia que estava no
// banco, em qualquer fuso.
export function dataIso(valor: unknown): string {
  if (valor instanceof Date) {
    const ano = valor.getFullYear();
    const mes = String(valor.getMonth() + 1).padStart(2, "0");
    const dia = String(valor.getDate()).padStart(2, "0");
    return `${ano}-${mes}-${dia}`;
  }
  return String(valor).slice(0, 10);
}

// Mesma coisa pra coluna que pode vir nula.
export function dataIsoOuNulo(valor: unknown): string | null {
  return valor === null || valor === undefined ? null : dataIso(valor);
}
