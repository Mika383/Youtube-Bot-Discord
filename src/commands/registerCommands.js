const { SlashCommandBuilder } = require('discord.js');

function buildCreatePlaylistCommand(commandName) {
  return new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('Quan ly playlist cua ban')
    .addSubcommand((sub) => sub
      .setName('create')
      .setDescription('Tao playlist moi')
      .addStringOption((o) => o.setName('name').setDescription('Ten playlist').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('delete')
      .setDescription('Xoa playlist')
      .addStringOption((o) => o.setName('name').setDescription('Ten playlist').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('rename')
      .setDescription('Doi ten playlist')
      .addStringOption((o) => o.setName('name').setDescription('Ten cu').setRequired(true))
      .addStringOption((o) => o.setName('new_name').setDescription('Ten moi').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('import')
      .setDescription('Tao playlist tu link playlist YouTube')
      .addStringOption((o) => o.setName('name').setDescription('Ten playlist local').setRequired(true))
      .addStringOption((o) => o.setName('url').setDescription('YouTube playlist URL').setRequired(true)));
}

function buildMyPlaylistCommand(commandName) {
  return new SlashCommandBuilder()
    .setName(commandName)
    .setDescription('Thao tac voi playlist cua ban')
    .addSubcommand((sub) => sub.setName('panel').setDescription('Mo UI quan ly playlist'))
    .addSubcommand((sub) => sub.setName('list').setDescription('Xem danh sach playlist'))
    .addSubcommand((sub) => sub
      .setName('view')
      .setDescription('Xem chi tiet playlist')
      .addStringOption((o) => o.setName('name').setDescription('Ten playlist').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('add')
      .setDescription('Them mot bai YouTube vao playlist')
      .addStringOption((o) => o.setName('name').setDescription('Ten playlist').setRequired(true))
      .addStringOption((o) => o.setName('url').setDescription('YouTube URL').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('remove')
      .setDescription('Xoa bai theo index trong playlist')
      .addStringOption((o) => o.setName('name').setDescription('Ten playlist').setRequired(true))
      .addIntegerOption((o) => o.setName('index').setDescription('Vi tri bai (1..n)').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('play')
      .setDescription('Phat toan bo playlist')
      .addStringOption((o) => o.setName('name').setDescription('Ten playlist').setRequired(true))
      .addBooleanOption((o) => o.setName('infinite').setDescription('Lap vo han playlist nay')))
    .addSubcommand((sub) => sub
      .setName('savequeue')
      .setDescription('Luu toan bo bai dang/co trong queue thanh playlist')
      .addStringOption((o) => o.setName('name').setDescription('Ten playlist dich').setRequired(true))
      .addStringOption((o) => o
        .setName('mode')
        .setDescription('Cach luu vao playlist dich')
        .setRequired(false)
        .addChoices(
          { name: 'replace', value: 'replace' },
          { name: 'append', value: 'append' },
        )));
}

function getCommandDefinitions() {
  return [
    new SlashCommandBuilder()
      .setName('play')
      .setDescription('Phat nhac bang URL, tim theo ten, hoac playlist da luu')
      .addSubcommand((sub) => sub
        .setName('url')
        .setDescription('Phat nhac tu YouTube URL')
        .addStringOption((o) => o.setName('input').setDescription('YouTube URL').setRequired(true)))
      .addSubcommand((sub) => sub
        .setName('search')
        .setDescription('Tim YouTube theo ten va phat')
        .addStringOption((o) => o.setName('input').setDescription('Ten bai hat / tu khoa').setRequired(true)))
      .addSubcommand((sub) => sub
        .setName('myplaylist')
        .setDescription('Phat ngay playlist da luu cua ban')
        .addStringOption((o) => o.setName('name').setDescription('Ten playlist').setRequired(true))
        .addBooleanOption((o) => o.setName('infinite').setDescription('Lap vo han playlist nay')))
      .addSubcommand((sub) => sub
        .setName('playlist')
        .setDescription('Phat playlist YouTube bang URL')
        .addStringOption((o) => o.setName('url').setDescription('YouTube playlist URL').setRequired(true))
        .addBooleanOption((o) => o.setName('infinite').setDescription('Lap vo han playlist nay'))),
    new SlashCommandBuilder().setName('skip').setDescription('Bo qua bai hien tai'),
    new SlashCommandBuilder().setName('stop').setDescription('Dung nhac va xoa hang cho'),
    new SlashCommandBuilder().setName('queue').setDescription('Xem hang cho hien tai'),
    new SlashCommandBuilder().setName('leave').setDescription('Roi voice channel'),
    new SlashCommandBuilder().setName('kill').setDescription('Huy phat nhac va roi voice channel ngay lap tuc'),
    new SlashCommandBuilder().setName('present').setDescription('Hien thi lai giao dien Now Playing'),
    buildCreatePlaylistCommand('createplaylist'),
    buildCreatePlaylistCommand('cpl'),
    buildMyPlaylistCommand('myplaylist'),
    buildMyPlaylistCommand('mpl'),
    new SlashCommandBuilder().setName('ringo').setDescription('Hien thi huong dan va toan bo lenh cua bot'),
  ];
}

module.exports = {
  getCommandDefinitions,
};
