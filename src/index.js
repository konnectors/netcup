const {
    BaseKonnector,
    requestFactory,
    log,
    saveBills
} = require('cozy-konnector-libs')
const sleep = require('util').promisify(global.setTimeout)
let request = requestFactory()
const jar = request.jar()
request = requestFactory({
    // debug: true,
    cheerio: true,
    json: false,
    jar
})
const requestRaw = requestFactory({
    // debug: true,
    cheerio: false,
    json: false,
    jar
})

const baseUrl = 'https://www.customercontrolpanel.de'

module.exports = new BaseKonnector(start)

async function start(fields) {
    log('info', 'Authenticating ...')
    await authenticate.bind(this)(fields.login, fields.password)
    log('info', 'Successfully logged in')

    const invoicePage = await request(`${baseUrl}/rechnungen.php`)
    await sleep(1000)

    const sessionhash = invoicePage.html().match(/sessionhash.?=.?"(.+?)"/)[1]
    const nocsrftoken = invoicePage.html().match(/nocsrftoken.?=.?"(.*?)"/)[1]
    log('debug', sessionhash)
    log('debug', nocsrftoken)

    const res = await getInvoices(sessionhash, nocsrftoken)
    const reg = /(pdf.php.+?)".+?(\d{2}\.\d{2}.\d{4}).+?(-?[\d,]+)/gs
    const pdfurls = []
    let m = []
    while ((m = reg.exec(res))) pdfurls.push(m.slice(1, 4))
    log('debug', pdfurls)

    await saveBills(
        pdfurls.map(([url, date, price]) => {
            const d = new Date()
            const [j, m, a] = date
                .match(/(\d{2}).(\d{2}).(\d{4})/)
                .slice(1, 4)
                .map(e => ~~e)
            d.setFullYear(a)
            d.setMonth(m - 1)
            d.setDate(j)
            d.setHours(0)
            return {
                amount: Math.abs(price.replace(',', '.')),
                isRefund: parseFloat(price.replace(',', '.')) < 0,
                vendor: 'netcup',
                date: d,
                fileurl: `${baseUrl}/${url}`,
                filename: `Facture netcup du ${a}-${pad(m)}-${pad(
                    j
                )} de ${price}.pdf`,
                requestOptions: { jar },
                currency: 'EUR',
                fileAttributes: {
                    metadata: {
                        carbonCopy: true,
                        classification: 'invoicing',
                        datetime: d,
                        datetimeLabel: 'issueDate',
                        contentAuthor: 'netcup',
                        subClassification: 'payment_statement',
                        issueDate: d,
                        contractReference: fields.username
                    }
                }
            }
        }),
        fields,
        {
            linkBankOperations: false
        }
    )
}

async function authenticate(username, password) {
    // load cookie
    await this.deactivateAutoSuccessfulLogin()
    await request(`${baseUrl}/index.php`)
    await sleep(100)
    const res = await request({
        method: 'POST',
        url: `${baseUrl}/start.php`,
        form: {
            action: 'login',
            ccp_user: username,
            ccp_password: password,
            nocsrftoken: ''
        }
    })
    if (res.html().includes('Error')) {
        throw new Error('LOGIN_FAILED')
    }
    this.notifySuccessfulLogin()
    return res
}

async function getInvoices(sessionhash, nocsrftoken) {
    return await requestRaw({
        url: `${baseUrl}/rechnungen_ajax.php?action=listinvoice&page=1&orderby=&sessionhash=${sessionhash}&nocsrftoken=${nocsrftoken}`,
        method: 'POST',
        form: {
            search: '',
            datefrom: '01.01.2000',
            dateto: '01.01.2999',
            entrysperpage: 50
        }
    })
}

const pad = (x, n = 2) => ('0'.repeat(n) + x.toString()).slice(-n)
