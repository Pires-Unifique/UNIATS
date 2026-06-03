/**
 * Seed mínimo para dev local — cria um usuário admin de teste.
 * Em produção este seed NÃO deve ser executado.
 */
import { PrismaClient, PapelUsuario } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
    if (process.env.NODE_ENV === 'production') {
        throw new Error('Seed bloqueado em produção');
    }
    const admin = await prisma.usuario.upsert({
        where: { email: 'admin@unifique.com.br' },
        update: {},
        create: {
            azure_oid: '00000000-0000-0000-0000-000000000001',
            email: 'admin@unifique.com.br',
            nome: 'Admin de Desenvolvimento',
            papel: PapelUsuario.ADMIN,
            ativo: true,
        },
    });
    console.log('[seed] usuário admin garantido:', admin.email);
}
main()
    .catch((err) => {
    console.error(err);
    process.exit(1);
})
    .finally(async () => {
    await prisma.$disconnect();
});
//# sourceMappingURL=seed.js.map