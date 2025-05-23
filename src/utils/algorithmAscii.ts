function _algorithmAscii(algorithm) {
  switch (algorithm) {
    case 0:
      return `



╔═╗ ╔═╗ ╔═╗ ╔═╗
║1╠═╣2╠═╣3╠═╣4╠══
╚═╝ ╚═╝ ╚═╝ ╚═╝



`
    case 1:
      return `

╔═╗
║1╠═╗
╚═╝ ║  ╔═╗  ╔═╗
    ╠══╣3╠══╣4╠══
╔═╗ ║  ╚═╝  ╚═╝
║2╠═╝
╚═╝

`
    case 2:
      return `

     ╔═╗
     ║1╠═╗
     ╚═╝ ║  ╔═╗
         ╠══╣4╠══
╔═╗  ╔═╗ ║  ╚═╝
║2╠══╣3╠═╝
╚═╝  ╚═╝

`
    case 3:
      return `

╔═╗  ╔═╗
║1╠══╣2╠═╗
╚═╝  ╚═╝ ║  ╔═╗
         ╠══╣4╠══
     ╔═╗ ║  ╚═╝
     ║3╠═╝
     ╚═╝

`
    case 4:
      return `

╔═╗  ╔═╗
║1╠══╣2╠═╗
╚═╝  ╚═╝ ║
         ╠══
╔═╗  ╔═╗ ║
║3╠══╣4╠═╝
╚═╝  ╚═╝

`
    case 5:
      return `
      ╔═╗
    ╔═╣2╠══╗
    ║ ╚═╝  ║
╔═╗ ║ ╔═╗  ║
║1╠═╬═╣3╠══╬══
╚═╝ ║ ╚═╝  ║
    ║ ╔═╗  ║
    ╚═╣4╠══╝
      ╚═╝`
    case 6:
      return `
 ╔═╗  ╔═╗
 ║1╠══╣2╠══╗
 ╚═╝  ╚═╝  ║
      ╔═╗  ║
      ║3╠══╬══
      ╚═╝  ║
      ╔═╗  ║
      ║4╠══╝
      ╚═╝`
    case 7:
      return `


╔═╗ ╔═╗ ╔═╗ ╔═╗
║1║ ║2║ ║3║ ║4║
╚╦╝ ╚╦╝ ╚╦╝ ╚╦╝
 ╚═══╩═╦═╩═══╝
       ║
       ╚══

`
    default:
      return 'no algorithm'
  }
}

const algorithmAscii = (algorithm) => {
  const str = _algorithmAscii(algorithm)
  const [firstLine, ...rest] = str.split('\n')
  return rest.join('\n')
}

export default algorithmAscii
