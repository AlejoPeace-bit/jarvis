import { notes } from "../memory.js";

export const memoryTools = [
  {
    definition: {
      name: "recordar",
      description:
        "Guarda un dato permanente sobre el usuario o sus preferencias (ej: 'el correo del contador es x', 'la reunión semanal de obra es los lunes a las 7'). Úsala cuando el usuario diga 'recuerda que...' o cuente algo útil para el futuro. No guardes datos de un solo uso.",
      input_schema: {
        type: "object",
        properties: {
          nota: { type: "string", description: "El dato a recordar, en una frase clara y corta." },
        },
        required: ["nota"],
      },
    },
    async execute({ nota }) {
      notes.add(nota);
      return "Guardado en memoria permanente.";
    },
  },
  {
    definition: {
      name: "olvidar",
      description: "Borra de la memoria permanente las notas que contengan el texto indicado. Úsala solo si el usuario pide olvidar o corregir algo guardado.",
      input_schema: {
        type: "object",
        properties: {
          texto: { type: "string", description: "Fragmento de la nota a borrar." },
        },
        required: ["texto"],
      },
    },
    async execute({ texto }) {
      const n = notes.remove(texto);
      return n ? `Se borraron ${n} nota(s).` : "No había ninguna nota con ese texto.";
    },
  },
];
