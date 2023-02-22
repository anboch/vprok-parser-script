import puppeteer from 'puppeteer'
import fs from 'fs'
import * as path from 'path'

const parseResultsDirTitle = 'parse_results'
const errorMessages = {
  WRONG_URL: 'Не верный URL',
  WRONG_REGION: 'Не верный регион',
  FAILED_PARSE_PRODUCT_PARAMETRS: 'Не удалось спарсить параметры продукта'
}
const getDateString = () => {
  const dateNow = new Date()
  return dateNow.getFullYear() + '-' +
      (dateNow.getMonth() + 1) + '-' +
      dateNow.getDate() + '_' +
      dateNow.getHours() + '-' +
      dateNow.getMinutes() + '-' +
      dateNow.getSeconds()
}

const changeRegion = async (page, newRegion) => {
  await (await page.waitForSelector('#__next')).click()
  const regionMenuButton = await page.waitForSelector('div[class^="FirstHeader_region"]')

  const currentRegion = await page.evaluate(() => {
    return document.querySelector('div[class^="FirstHeader_region"] > span')?.textContent
  })
  if (currentRegion === newRegion) {
    return
  }

  await regionMenuButton.hover()
  await regionMenuButton.click()

  await page.waitForSelector('[class^="RegionModal_item"]')
  const regionButtons = (await page.$x(`//div[text()='${newRegion}']`))
  if (regionButtons.length === 0) {
    throw new Error(errorMessages.WRONG_REGION)
  }
  await Promise.all([
    page.waitForNavigation({ waitUntil: ['networkidle2', 'load', 'domcontentloaded'] }),
    regionButtons[0].hover(),
    regionButtons[0].click()
  ])
}

const saveProductProperties = async (dateString, productProperties, productId, parseResultsPath) => {
  const text = dateString + '\n' +
  'price=' + productProperties.price + '\n' +
  'priceOld=' + productProperties.priceOld + '\n' +
  'rating=' + productProperties.rating + '\n' +
  'reviewCount=' + productProperties.reviewCount + '\n'
  await fs.promises.writeFile(path.join(parseResultsPath, productId + '_product.txt'), text + '\n', { flag: 'a' })
}

const runParse = async () => {
  const url = process.argv[2]
  if (!url.includes('https://www.vprok.ru/product/')) {
    throw Error(errorMessages.WRONG_URL)
  }

  const region = process.argv[3]
  if (!region) {
    throw new Error(errorMessages.WRONG_REGION)
  }

  const browser = await puppeteer.launch()
  const page = await browser.newPage()
  await page.setViewport({ width: 1080, height: 1024 })
  await page.setCookie({
    name: 'isUserAgreeCookiesPolicy',
    value: 'true',
    domain: '.vprok.ru'
  })
  await page.goto(url)

  await changeRegion(page, region)

  try {
    const productProperties = await page.evaluate(() => {
      const price = document.querySelector('[class^="BuyQuant_price"] span[class*="Price_size"]')?.textContent.split(' ')[0]
      const priceDiscount = document.querySelector('[class^="BuyQuant_price"] span[class*="Price_role_discount"]')?.textContent.split(' ')[0]
      const priceOld = document.querySelector('[class^="BuyQuant_price"] span[class*="Price_role_old"]')?.textContent.split(' ')[0]
      const rating = document.querySelector('[class^="Summary_reviewsContainer"] [itemprop="ratingValue"]')?.textContent
      const reviewCount = document.querySelector('[class*="Summary_reviewsCountContainer"] [class^="Summary_title"]')?.textContent.replace(/\D/g, '')
      if (!price || !rating || !reviewCount || (priceDiscount && !priceOld)) {
        throw new Error(errorMessages.FAILED_PARSE_PRODUCT_PARAMETRS)
      }
      return { price, priceOld: priceOld ?? null, rating, reviewCount }
    })

    const productId = url.split('--')[1]
    const parseResultsPath = path.join(process.cwd(), parseResultsDirTitle, region.replace(/[.]/g, ''))
    if (!fs.existsSync(parseResultsPath)) {
      fs.mkdirSync(parseResultsPath, { recursive: true })
    }
    const dateString = getDateString()
    const screanshotTitle = dateString + '_#' + productId + '_screenshot.jpg'

    await page.screenshot({
      path: path.join(parseResultsPath, screanshotTitle),
      fullPage: true
    })

    await saveProductProperties(dateString, productProperties, productId, parseResultsPath)

    await browser.close()
  } catch (error) {
    const unknownError = await page.$('div[class^="UnknownError"]')
    const notFoundError = await page.$('div[class^="NotFoundError"]')
    if (notFoundError || unknownError) {
      throw new Error(errorMessages.WRONG_URL)
    } else {
      throw new Error(error.message)
    }
  }
}

const runner = async (maxAttempts = 1, attemptsCounter = 0) => {
  try {
    await runParse()
    console.log('Парсинг прошёл успешно')
  } catch (error) {
    if (error.message === errorMessages.WRONG_URL ||
        error.message === errorMessages.WRONG_REGION
    ) {
      throw new Error(error.message)
    } else {
      attemptsCounter++
      if (attemptsCounter < maxAttempts) {
        console.log(`Попытка ${attemptsCounter} из ${maxAttempts} не удалась из-за ошибки: ${error.message}`)
        await runner(maxAttempts, attemptsCounter)
      } else {
        console.log(`Не удалось спарсить после ${maxAttempts} попыток`)
      }
    }
  }
}

await runner(3)
