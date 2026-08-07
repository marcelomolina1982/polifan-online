export const figuresDefault = [
  'Corazón con división','Corazón simple','Boca','Infinito','Caramelo','Mariposa',
  'Amigos abrazados','Arcoíris','Rompecabezas corazón','Osito','TE AMO','Unicornio',
  'Dinosaurio','Auto','Rosa','Mate','Labios','Cabeza Roblox','Número 15 con alas',
  'Nombre personalizado','Nube','Estrella','Luna','Corona','Pelota','Escudo','Flor',
  'Manzana','Banana','Brócoli','Acelga','Ananá','Abejita','Perro salchicha','Gatito',
  'Mariposa simple','Número','Letra','Cartel personalizado'
]

export const emptyState = () => ({
  orders: [], movements: [], stockMin: {}, figures: figuresDefault, clients: [], cutBatches: [], incomes: [], expenses: [], customerSettings: { whatsapp:'', businessName:'Tu Vida En Tinta' }, customerCatalog: [], svgLibrary: [], generatedSheets: [], productionClosedDates: [], attentionMessages: [], attentionTemplates: {}, quotes: []
})

export const statusColors = {
  'Ingresado':'gray','En diseño':'yellow','Listo para cortar':'blue',
  'Cortado':'green','Entregado':'purple','Cancelado':'red'
}
